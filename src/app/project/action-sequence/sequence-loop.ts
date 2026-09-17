import { resolveActionSequence, type ResolvedActionSequence } from "./resolve-sequence";
import type { ActionSequenceConfig, ModelPose } from "./types";

export const SEQUENCE_LOOP_CLEARED_TOAST = "起点与终点位姿不一致，已关闭循环";
export const SEQUENCE_LOOP_DISABLED_HINT = "起点与终点位姿不一致，无法循环";

const V1_EPS_MM = 1;
const ANGLE_EPS_DEG = 0.1;
const CLOSED_POSE_SLACK = 1e-9;

const within = (left: number, right: number, epsilon: number): boolean =>
  Math.abs(left - right) <= epsilon + CLOSED_POSE_SLACK;

export const posesAreClosed = (start: ModelPose, end: ModelPose): boolean =>
  within(start.v1, end.v1, V1_EPS_MM) &&
  within(start.v2, end.v2, ANGLE_EPS_DEG) &&
  within(start.v3, end.v3, ANGLE_EPS_DEG);

export const sequencePathIsClosed = (resolved: ResolvedActionSequence): boolean => {
  if (resolved.posesByObject.size === 0) return false;
  for (const poses of resolved.posesByObject.values()) {
    const first = poses[0];
    const last = poses[poses.length - 1];
    if (first === undefined || last === undefined) return false;
    if (!posesAreClosed(first.pose, last.pose)) return false;
  }
  return true;
};

export const actionSequencePathIsClosed = (sequence: ActionSequenceConfig): boolean => {
  try {
    return sequencePathIsClosed(resolveActionSequence(sequence));
  } catch {
    return false;
  }
};

export const isSequenceLooping = (sequence: ActionSequenceConfig): boolean => sequence.loop === true;

export const reconcileSequenceLoop = (
  sequence: ActionSequenceConfig,
): { sequence: ActionSequenceConfig; cleared: boolean } => {
  if (sequence.loop !== true) return { sequence, cleared: false };
  if (actionSequencePathIsClosed(sequence)) return { sequence, cleared: false };
  return { sequence: { ...sequence, loop: false }, cleared: true };
};
