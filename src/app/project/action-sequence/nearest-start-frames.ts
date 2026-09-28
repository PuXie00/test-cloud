import type { VirtualAxisId } from "../project-document-types";
import { interpolatePoseWithProfiles } from "./evaluate-sequence";
import { calculateMotionProfileKinematics, sampleVelocityNorm } from "./motion-profile";
import type { ResolvedActionSequence, ResolvedMotionSegment } from "./resolve-sequence";
import type { ModelPose } from "./types";

export const AXES: readonly VirtualAxisId[] = ["v1", "v2", "v3"];

export type MemberTimeline = {
  objectId: number;
  firstMs: number;
  lastMs: number;
  startPose: ModelPose;
  endPose: ModelPose;
  segments: ResolvedMotionSegment[];
  keyframes: number[];
};

const ZERO_POSE: ModelPose = { v1: 0, v2: 0, v3: 0 };

const clonePose = (pose: ModelPose): ModelPose => ({ v1: pose.v1, v2: pose.v2, v3: pose.v3 });

export const memberTimeline = (
  resolved: ResolvedActionSequence,
  objectId: number,
): MemberTimeline | null => {
  const poses = resolved.posesByObject.get(objectId) ?? [];
  const first = poses[0];
  const last = poses[poses.length - 1];
  if (!first || !last) return null;
  const segments = resolved.segments
    .filter((segment) => segment.objectId === objectId)
    .sort((left, right) => left.startMs - right.startMs);
  return {
    objectId,
    firstMs: first.atMs,
    lastMs: last.atMs,
    startPose: clonePose(first.pose),
    endPose: clonePose(last.pose),
    segments,
    keyframes: [...new Set(poses.map((pose) => pose.atMs))],
  };
};

export type MemberSample = {
  pose: ModelPose;
  /** 曲线速度，单位/100ms（与 PLC `_T` 时间单位一致） */
  velocityPer100ms: ModelPose;
};

const segmentVelocityPerSecond = (
  segment: ResolvedMotionSegment,
  axis: VirtualAxisId,
  tNorm: number,
): number => {
  const profile = segment.settings.profiles[axis];
  const travel = segment.toPose[axis] - segment.fromPose[axis];
  if (profile.kind === "idle" || travel === 0) return 0;
  const { peakVelocity } = calculateMotionProfileKinematics(profile, travel, segment.durationMs);
  return Math.sign(travel) * peakVelocity * sampleVelocityNorm(profile, tNorm, segment.durationMs);
};

/** 等价 Python evaluate_model：首帧前取起点、末帧后取终点，曲线速度为 0。 */
export const sampleMember = (member: MemberTimeline, frameMs: number): MemberSample => {
  if (frameMs <= member.firstMs) {
    return { pose: clonePose(member.startPose), velocityPer100ms: { ...ZERO_POSE } };
  }
  if (frameMs >= member.lastMs) {
    return { pose: clonePose(member.endPose), velocityPer100ms: { ...ZERO_POSE } };
  }
  const segment =
    member.segments.find((item) => item.startMs <= frameMs && frameMs < item.endMs) ?? null;
  if (!segment || segment.durationMs <= 0) {
    const held = [...member.segments].reverse().find((item) => item.endMs <= frameMs);
    return {
      pose: clonePose(held ? held.toPose : member.startPose),
      velocityPer100ms: { ...ZERO_POSE },
    };
  }
  const tNorm = (frameMs - segment.startMs) / segment.durationMs;
  const pose = interpolatePoseWithProfiles(
    segment.fromPose,
    segment.toPose,
    segment.settings.profiles,
    tNorm,
    segment.durationMs,
  );
  const velocityPer100ms = { ...ZERO_POSE };
  for (const axis of AXES) {
    velocityPer100ms[axis] = segmentVelocityPerSecond(segment, axis, tNorm) / 10;
  }
  return { pose, velocityPer100ms };
};

/** 强制轨迹 loop_once=false：正向只包裹右端、反向只包裹左端（PLC 规则）。 */
export const mapForcedFrame = (
  member: MemberTimeline,
  globalFrame: number,
  direction: 1 | -1,
  loopOnce: boolean,
): number => {
  if (loopOnce) return globalFrame;
  const period = member.lastMs - member.firstMs;
  if (period <= 0) return globalFrame;
  if (direction > 0 && globalFrame > member.lastMs) {
    const remainder = (globalFrame - member.lastMs) % period;
    return Math.abs(remainder) <= 1e-12 ? member.lastMs : member.firstMs + remainder;
  }
  if (direction < 0 && globalFrame < member.firstMs) {
    const remainder = (member.firstMs - globalFrame) % period;
    return Math.abs(remainder) <= 1e-12 ? member.firstMs : member.lastMs - remainder;
  }
  return globalFrame;
};

export const sharedKeyframes = (members: readonly MemberTimeline[]): number[] =>
  [...new Set(members.flatMap((member) => member.keyframes))].sort((left, right) => left - right);
