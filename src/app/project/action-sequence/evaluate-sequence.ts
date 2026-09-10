import { evaluateMotionProfile } from "./motion-profile";
import type { AxisMotionProfiles, ModelPose } from "./types";
import type {
  ResolvedActionSequence,
  ResolvedMotionSegment,
  ResolvedPosePoint,
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
    if (cursorMs < segment.endMs) {
      const progress = (cursorMs - segment.startMs) / segment.durationMs;
      return interpolatePoseWithProfiles(
        segment.fromPose,
        segment.toPose,
        segment.settings.profiles,
        progress,
        segment.durationMs,
      );
    }
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
