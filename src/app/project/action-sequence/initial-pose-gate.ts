import type {
  ControlledObjectConfig,
  MotorConfig,
  VirtualAxisId,
} from "@/app/project/project-document-types";
import type { ActionSequenceConfig, ModelPose } from "./types";
import { isSequenceLooping } from "./sequence-loop";
import { planNearestStart, type NearestStartMember, type NearestStartPlan } from "./nearest-start";
import { memberTimeline, sharedKeyframes } from "./nearest-start-frames";
import { buildNearestStartMember } from "./nearest-start-model";
import type { HpyPose } from "./nearest-start-motion";
import { resolveActionSequence, type ResolvedActionSequence } from "./resolve-sequence";

export type { HpyPose } from "./nearest-start-motion";

const AXIS_EPSILON: Record<VirtualAxisId, number> = {
  v1: 1,
  v2: 0.1,
  v3: 0.1,
};

const CLOSED_POSE_SLACK = 1e-9;

/** 强制轨迹 xSafe=false 表示当前位置不在轨迹上，禁止准备。 */
export const BLOCK_READY_WHEN_FORCED_UNSAFE = true;

export const FORCED_UNSAFE_MESSAGE = "当前位置不在轨迹上（xSafe 未通过），禁止准备";

export const hpyFromPositions = (
  positions: { h?: number; p?: number; y?: number } | null | undefined,
): HpyPose => ({
  h: positions?.h ?? 0,
  p: positions?.p ?? 0,
  y: positions?.y ?? 0,
});

const poseFromHpy = (pose: HpyPose): ModelPose => ({ v1: pose.h, v2: pose.p, v3: pose.y });

export type PreparedPoses = Record<number, HpyPose>;

export const capturePreparedPoses = (
  objectIds: Iterable<number>,
  telemetryByObjectId: ReadonlyMap<number, HpyPose>,
): PreparedPoses => {
  const poses: PreparedPoses = {};
  for (const objectId of objectIds) {
    const pose = telemetryByObjectId.get(objectId) ?? { h: 0, p: 0, y: 0 };
    poses[objectId] = { h: pose.h, p: pose.p, y: pose.y };
  }
  return poses;
};

export const preparedPosesMatchTelemetry = (
  prepared: PreparedPoses,
  objects: readonly { id: number; enabledVirtualAxes: readonly VirtualAxisId[] }[],
  telemetryByObjectId: ReadonlyMap<number, HpyPose>,
): boolean => {
  for (const [idText, preparedPose] of Object.entries(prepared)) {
    const objectId = Number(idText);
    const object = objects.find((item) => item.id === objectId);
    const current = telemetryByObjectId.get(objectId) ?? { h: 0, p: 0, y: 0 };
    const enabled = object?.enabledVirtualAxes ?? (["v1", "v2", "v3"] as const);
    if (!enabledAxesMatchStart(enabled, current, poseFromHpy(preparedPose))) return false;
  }
  return true;
};

export const enabledAxesMatchStart = (
  enabledAxes: readonly VirtualAxisId[],
  current: HpyPose,
  target: ModelPose,
): boolean => {
  const currentPose = poseFromHpy(current);
  return enabledAxes.every(
    (axis) =>
      Math.abs(currentPose[axis] - target[axis]) <= AXIS_EPSILON[axis] + CLOSED_POSE_SLACK,
  );
};

export type StartGateOptions = { nearest: boolean; reverse: boolean };

export type StartGateInput = StartGateOptions & {
  sequence: ActionSequenceConfig;
  objects: readonly ControlledObjectConfig[];
  motors: readonly MotorConfig[];
  telemetryByObjectId: ReadonlyMap<number, HpyPose>;
};

export type StartGateTiming = {
  plan: NearestStartPlan;
  transitionSeconds: number;
  programSeconds: number;
  totalSeconds: number;
};

export type StartGateResult =
  | { status: "at-start"; plan: NearestStartPlan }
  | ({ status: "transition" } & StartGateTiming)
  | ({ status: "blocked"; message: string } & StartGateTiming)
  | { status: "error"; message: string };

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const boundaryFrameMs = (resolved: ResolvedActionSequence, reverse: boolean): number => {
  const frames = sharedKeyframes(
    [...resolved.posesByObject.keys()].flatMap((objectId) => {
      const timeline = memberTimeline(resolved, objectId);
      return timeline ? [timeline] : [];
    }),
  );
  if (frames.length === 0) return reverse ? resolved.totalMs : 0;
  return reverse ? frames[frames.length - 1]! : frames[0]!;
};

/** 已在起点：不下发成员运动，只标明从第一帧或末帧开始。 */
export const atStartPlan = (input: {
  resolved: ResolvedActionSequence;
  forced: boolean;
  nearest: boolean;
  reverse: boolean;
}): NearestStartPlan => ({
  forced: input.forced,
  nearest: input.nearest,
  direction: input.reverse ? -1 : 1,
  startMode: "at-start",
  targetFrameMs: boundaryFrameMs(input.resolved, input.reverse),
  transitionSec: 0,
  xSafe: null,
  motorLimitScale: null,
  members: [],
});
const boundaryPoseAt = (
  resolved: ResolvedActionSequence,
  objectId: number,
  reverse: boolean,
): ModelPose | null => {
  const timeline = memberTimeline(resolved, objectId);
  if (!timeline) return null;
  return reverse ? timeline.endPose : timeline.startPose;
};

/** 过渡结束后剩余的编程时长：正向从目标帧走到末尾，反向从目标帧倒回 0。 */
export const remainingProgramMs = (plan: NearestStartPlan, totalMs: number): number =>
  plan.direction > 0 ? Math.max(0, totalMs - plan.targetFrameMs) : Math.max(0, plan.targetFrameMs);

export const planStartTransition = (input: {
  resolved: ResolvedActionSequence;
  sequence: ActionSequenceConfig;
  objects: readonly ControlledObjectConfig[];
  motors: readonly MotorConfig[];
  telemetryByObjectId: ReadonlyMap<number, HpyPose>;
  nearest: boolean;
  reverse: boolean;
}): NearestStartPlan => {
  const members: NearestStartMember[] = [];
  let offStart = false;
  for (const objectId of input.resolved.posesByObject.keys()) {
    const object = input.objects.find((item) => item.id === objectId);
    if (!object) throw new Error(`缺少受控物体 ${objectId}`);
    if (object.enabledVirtualAxes.length === 0) continue;
    const current = input.telemetryByObjectId.get(objectId) ?? { h: 0, p: 0, y: 0 };
    const boundary = boundaryPoseAt(input.resolved, objectId, input.reverse);
    if (boundary && !enabledAxesMatchStart(object.enabledVirtualAxes, current, boundary)) {
      offStart = true;
    }
    members.push(buildNearestStartMember(object, input.motors, poseFromHpy(current)));
  }
  if (!offStart) {
    return atStartPlan({
      resolved: input.resolved,
      forced: input.sequence.trajectoryMode === true,
      nearest: input.nearest,
      reverse: input.reverse,
    });
  }
  return planNearestStart({
    resolved: input.resolved,
    members,
    forced: input.sequence.trajectoryMode === true,
    nearest: input.nearest,
    reverse: input.reverse,
    loopOnce: !isSequenceLooping(input.sequence),
  });
};

export const evaluateStartGate = (input: StartGateInput): StartGateResult => {
  let resolved: ResolvedActionSequence;
  try {
    resolved = resolveActionSequence(input.sequence);
  } catch (error) {
    return { status: "error", message: errorMessage(error, "动作序列无法解析") };
  }

  let plan: NearestStartPlan;
  try {
    plan = planStartTransition({ ...input, resolved });
  } catch (error) {
    return { status: "error", message: errorMessage(error, "起始位姿过渡计算失败") };
  }
  if (plan.startMode === "at-start") return { status: "at-start", plan };

  const timing: StartGateTiming = {
    plan,
    transitionSeconds: plan.transitionSec,
    programSeconds: resolved.totalMs / 1000,
    totalSeconds: plan.transitionSec + remainingProgramMs(plan, resolved.totalMs) / 1000,
  };
  if (BLOCK_READY_WHEN_FORCED_UNSAFE && plan.forced && plan.xSafe === false) {
    return { status: "blocked", message: FORCED_UNSAFE_MESSAGE, ...timing };
  }
  return { status: "transition", ...timing };
};
