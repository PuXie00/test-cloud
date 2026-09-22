import type {
  ControlledObjectConfig,
  MotorConfig,
  VirtualAxisId,
} from "@/app/project/project-document-types";
import type { ActionSequenceConfig, ModelPose } from "./types";
import type { HpyPose, InitialTransitionPlan } from "./initial-transition-planner";
import * as initialTransitionPlanner from "./initial-transition-planner";
import { resolveActionSequence } from "./resolve-sequence";
import {
  buildInitialTransitionModels,
  type PoseSpeedMode,
  type TransitionMember,
} from "./initial-pose-model";

export type { PoseSpeedMode };

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

export const enabledAxesMatchStart = (
  enabledAxes: readonly VirtualAxisId[],
  current: HpyPose,
  target: ModelPose,
): boolean => {
  const currentByAxis: Record<VirtualAxisId, number> = {
    v1: current.h,
    v2: current.p,
    v3: current.y,
  };
  const targetByAxis: Record<VirtualAxisId, number> = {
    v1: target.v1,
    v2: target.v2,
    v3: target.v3,
  };
  for (const axis of enabledAxes) {
    if (Math.abs(currentByAxis[axis] - targetByAxis[axis]) > AXIS_EPSILON[axis] + CLOSED_POSE_SLACK) {
      return false;
    }
  }
  return true;
};

export type InitialPoseGateInput = {
  sequence: ActionSequenceConfig;
  objects: readonly ControlledObjectConfig[];
  motors: readonly MotorConfig[];
  telemetryByObjectId: ReadonlyMap<number, HpyPose>;
  speedMode: PoseSpeedMode;
  sequenceDurationMs: number;
};

export type InitialPoseGateResult =
  | { status: "at-start" }
  | {
      status: "transition";
      plan: InitialTransitionPlan;
      extraSeconds: number;
      totalSeconds: number;
    }
  | { status: "error"; message: string };

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export const evaluateInitialPoseGate = (input: InitialPoseGateInput): InitialPoseGateResult => {
  let resolved;
  try {
    resolved = resolveActionSequence(input.sequence);
  } catch (error) {
    return { status: "error", message: errorMessage(error, "动作序列无法解析") };
  }

  const offStart: TransitionMember[] = [];
  for (const [objectId, point] of resolved.initialPoseByObject) {
    const object = input.objects.find((item) => item.id === objectId);
    if (!object) return { status: "error", message: `缺少受控物体 ${objectId}` };
    const current = input.telemetryByObjectId.get(objectId) ?? { h: 0, p: 0, y: 0 };
    if (enabledAxesMatchStart(object.enabledVirtualAxes, current, point.pose)) continue;
    offStart.push({ object, current, target: point.pose });
  }
  if (offStart.length === 0) return { status: "at-start" };

  try {
    const plan = initialTransitionPlanner.planInitialTransition(
      buildInitialTransitionModels({
        members: offStart,
        motors: input.motors,
        speedMode: input.speedMode,
      }),
    );
    return {
      status: "transition",
      plan,
      extraSeconds: plan.totalTime,
      totalSeconds: plan.totalTime + input.sequenceDurationMs / 1000,
    };
  } catch (error) {
    return { status: "error", message: errorMessage(error, "起始位姿过渡计算失败") };
  }
};
