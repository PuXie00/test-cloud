import type {
  ControlledObjectConfig,
  MotorConfig,
  VirtualAxisId,
} from "@/app/project/project-document-types";
import type { ActionSequenceConfig, ModelPose } from "./types";
import { isSequenceLooping } from "./sequence-loop";
import { planNearestStart, type NearestStartPlan } from "./nearest-start";
import type { HpyPose } from "./nearest-start-motion";
import { resolveActionSequence, type ResolvedActionSequence } from "./resolve-sequence";

export type { HpyPose } from "./nearest-start-motion";

const AXIS_EPSILON: Record<VirtualAxisId, number> = {
  v1: 1,
  v2: 0.1,
  v3: 0.1,
};

const CLOSED_POSE_SLACK = 1e-9;

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

/** 就近算法算出的每个准备 Move 都在 1mm / 0.1° 以内：已在接入点，不用确认过渡 */
export const planIsAtStart = (plan: NearestStartPlan): boolean =>
  plan.members.every((member) =>
    member.axes.every(
      (move) => Math.abs(move.to - move.from) <= AXIS_EPSILON[move.axis] + CLOSED_POSE_SLACK,
    ),
  );

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
  | { status: "error"; message: string };

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

/** 过渡结束后剩余的编程时长：正向从目标帧走到末尾，反向从目标帧倒回 0。 */
export const remainingProgramMs = (plan: NearestStartPlan, totalMs: number): number =>
  plan.direction > 0 ? Math.max(0, totalMs - plan.targetFrameMs) : Math.max(0, plan.targetFrameMs);

/** C++ / PLC 循环配置：0 一直循环，1 播一次 */
export const sequenceLoopCount = (sequence: ActionSequenceConfig): 0 | 1 =>
  isSequenceLooping(sequence) ? 0 : 1;

/**
 * 不论在不在起点都跑就近算法：它给出接入帧、准备 V/A 与共同准备时间。
 * 先按回起点算，所有准备 Move 都在容差内就是已在起点（非强制就近即使停在起点也会跳到下一关键帧，
 * 所以不能先就近）；不在起点且开了就近，再按就近算。在容差内的计划标为 at-start，仍保留算法的 V/A 供下发。
 */
export const planStartTransition = (input: {
  resolved: ResolvedActionSequence;
  sequence: ActionSequenceConfig;
  objects: readonly ControlledObjectConfig[];
  motors: readonly MotorConfig[];
  telemetryByObjectId: ReadonlyMap<number, HpyPose>;
  nearest: boolean;
  reverse: boolean;
}): NearestStartPlan => {
  const planWith = (nearest: boolean) =>
    planNearestStart({
      resolved: input.resolved,
      objects: input.objects,
      motors: input.motors,
      telemetryByObjectId: input.telemetryByObjectId,
      forced: input.sequence.trajectoryMode === true,
      nearest,
      reverse: input.reverse,
      loopCount: sequenceLoopCount(input.sequence),
    });
  const atStart = (plan: NearestStartPlan): NearestStartPlan => ({
    ...plan,
    nearest: input.nearest,
    startMode: "at-start",
  });

  let boundary: NearestStartPlan;
  try {
    boundary = planWith(false);
  } catch (error) {
    // 回起点算不出来时，开了就近仍可以接到别的帧
    if (!input.nearest) throw error;
    const nearest = planWith(true);
    return planIsAtStart(nearest) ? atStart(nearest) : nearest;
  }
  if (planIsAtStart(boundary)) return atStart(boundary);
  if (!input.nearest) return boundary;
  const nearest = planWith(true);
  return planIsAtStart(nearest) ? atStart(nearest) : nearest;
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

  return {
    status: "transition",
    plan,
    transitionSeconds: plan.transitionSec,
    programSeconds: resolved.totalMs / 1000,
    totalSeconds: plan.transitionSec + remainingProgramMs(plan, resolved.totalMs) / 1000,
  };
};
