import type { VirtualAxisId } from "../project-document-types";
import {
  calculateMotionProfileKinematics,
  evaluateMotionProfile,
  sampleVelocityNorm,
} from "./motion-profile";
import type { AxisMotionProfiles, ModelPose } from "./types";
import {
  segmentAxisMotion,
  type ResolvedActionSequence,
  type ResolvedAxisMotion,
  type ResolvedMotionSegment,
  type ResolvedPosePoint,
} from "./resolve-sequence";

const clonePose = (pose: ModelPose): ModelPose => ({ v1: pose.v1, v2: pose.v2, v3: pose.v3 });

export const interpolatePoseWithProfiles = (
  from: ModelPose,
  to: ModelPose,
  profiles: AxisMotionProfiles,
  tNorm: number,
  durationMs: number,
): ModelPose => ({
  v1: from.v1 + (to.v1 - from.v1) * evaluateMotionProfile(profiles.v1, tNorm, durationMs),
  v2: from.v2 + (to.v2 - from.v2) * evaluateMotionProfile(profiles.v2, tNorm, durationMs),
  v3: from.v3 + (to.v3 - from.v3) * evaluateMotionProfile(profiles.v3, tNorm, durationMs),
});

/** 轴曲线在某一时刻的位置（时刻在曲线范围外时取端点） */
export const axisMotionValueAt = (motion: ResolvedAxisMotion, atMs: number): number => {
  const travel = motion.to - motion.from;
  if (travel === 0 || motion.durationMs <= 0) return atMs < motion.endMs ? motion.from : motion.to;
  const progress = (atMs - motion.startMs) / motion.durationMs;
  return motion.from + travel * evaluateMotionProfile(motion.profile, progress, motion.durationMs);
};

/** 轴曲线在某一时刻的带符号速度，单位/秒 */
export const axisMotionVelocityAt = (motion: ResolvedAxisMotion, atMs: number): number => {
  const travel = motion.to - motion.from;
  if (motion.profile.kind === "idle" || travel === 0 || motion.durationMs <= 0) return 0;
  const tNorm = (atMs - motion.startMs) / motion.durationMs;
  const { peakVelocity } = calculateMotionProfileKinematics(motion.profile, travel, motion.durationMs);
  return Math.sign(travel) * peakVelocity * sampleVelocityNorm(motion.profile, tNorm, motion.durationMs);
};

const AXES: readonly VirtualAxisId[] = ["v1", "v2", "v3"];

/** 区间内某一时刻的位姿；各轴按自己跟随的曲线算，不设定的轴跨区间连续运动 */
export const segmentPoseAt = (segment: ResolvedMotionSegment, atMs: number): ModelPose => {
  const pose: ModelPose = { v1: 0, v2: 0, v3: 0 };
  for (const axis of AXES) pose[axis] = axisMotionValueAt(segmentAxisMotion(segment, axis), atMs);
  return pose;
};

const poseAtCursor = (
  poses: ResolvedPosePoint[],
  segments: ResolvedMotionSegment[],
  cursorMs: number,
): ModelPose | undefined => {
  const first = poses[0];
  if (first === undefined) return undefined;
  if (cursorMs <= first.atMs) return clonePose(first.pose);

  for (const segment of segments) {
    if (cursorMs < segment.startMs) return clonePose(segment.fromPose);
    if (cursorMs < segment.endMs) return segmentPoseAt(segment, cursorMs);
  }

  return clonePose(poses[poses.length - 1]!.pose);
};

export const evaluateResolvedSequence = (
  resolved: ResolvedActionSequence,
  cursorMs: number,
): Map<number, ModelPose> => {
  const result = new Map<number, ModelPose>();
  const segmentsByObject = new Map<number, ResolvedMotionSegment[]>();

  for (const segment of resolved.segments) {
    const list = segmentsByObject.get(segment.objectId);
    if (list) list.push(segment);
    else segmentsByObject.set(segment.objectId, [segment]);
  }

  for (const objectId of resolved.posesByObject.keys()) {
    const poses = resolved.posesByObject.get(objectId) ?? [];
    const pose = poseAtCursor(poses, segmentsByObject.get(objectId) ?? [], cursorMs);
    if (pose !== undefined) result.set(objectId, pose);
  }

  return result;
};
