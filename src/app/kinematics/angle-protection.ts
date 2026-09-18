import { interpolatePoseWithProfiles } from "@/app/project/action-sequence/evaluate-sequence";
import type { ModelPose } from "@/app/project/action-sequence/types";
import type { ResolvedMotionSegment, ResolvedPosePoint } from "@/app/project/action-sequence/resolve-sequence";

export const ANGLE_PROTECTION_SAMPLE_MS = 100;

export type AngleProtectionLimits = {
  minHeight: number;
  maxHeight: number;
  radius: number;
  minPitch: number;
  maxPitch: number;
};

export type AngleProtectionObject = AngleProtectionLimits & {
  objectId: number;
};

export type AngleProtectionHit = {
  objectId: number;
  atMs: number;
  height: number;
  pitch: number;
  limitMin: number;
  limitMax: number;
  message: string;
  segmentKey?: string;
  blockId?: string;
};

const RAD_TO_DEG = 180 / Math.PI;

const formatQty = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

export const formatAngleProtectionMessage = (hit: {
  height: number;
  pitch: number;
  limitMin: number;
  limitMax: number;
}): string =>
  `当前高度 ${formatQty(hit.height)} mm 下虚轴2 允许 [${formatQty(hit.limitMin)}, ${formatQty(hit.limitMax)}]°，实际 ${formatQty(hit.pitch)}°`;

const pitchEnvelopeDeg = (height: number, limits: AngleProtectionLimits): number => {
  if (!(limits.radius > 0)) return 90;
  const hTop = Math.max(0, height - limits.minHeight);
  const hBottom = Math.max(0, limits.maxHeight - height);
  const hMin = Math.min(hTop, hBottom);
  if (hMin >= limits.radius) return 90;
  return Math.asin(hMin / limits.radius) * RAD_TO_DEG;
};

const signedZero = (value: number): number => (value === 0 ? 0 : value);

export const pitchLimitsAtHeight = (
  height: number,
  limits: AngleProtectionLimits,
): { min: number; max: number } => {
  const envelope = pitchEnvelopeDeg(height, limits);
  return {
    min: signedZero(Math.max(-envelope, limits.minPitch)),
    max: signedZero(Math.min(envelope, limits.maxPitch)),
  };
};

const sampleTimesMs = (startMs: number, endMs: number, stepMs: number): number[] => {
  const times: number[] = [];
  for (let time = startMs; time < endMs; time += stepMs) times.push(time);
  times.push(endMs);
  return times;
};

const poseAtProgress = (segment: ResolvedMotionSegment, progress: number): ModelPose =>
  interpolatePoseWithProfiles(
    segment.fromPose,
    segment.toPose,
    segment.settings.profiles,
    progress,
    segment.durationMs,
  );

const excessOf = (pitch: number, min: number, max: number): number =>
  Math.max(min - pitch, pitch - max, 0);

const hitOf = (
  object: AngleProtectionObject,
  pose: ModelPose,
  atMs: number,
  extra: { segmentKey?: string; blockId?: string },
): AngleProtectionHit | null => {
  const limits = pitchLimitsAtHeight(pose.v1, object);
  if (excessOf(pose.v2, limits.min, limits.max) <= 1e-9) return null;
  return {
    objectId: object.objectId,
    atMs,
    height: pose.v1,
    pitch: pose.v2,
    limitMin: limits.min,
    limitMax: limits.max,
    message: formatAngleProtectionMessage({
      height: pose.v1,
      pitch: pose.v2,
      limitMin: limits.min,
      limitMax: limits.max,
    }),
    ...extra,
  };
};

const checkSegment = (
  object: AngleProtectionObject,
  segment: ResolvedMotionSegment,
  stepMs: number,
): AngleProtectionHit | null => {
  if (segment.durationMs <= 0) return null;
  const times = sampleTimesMs(segment.startMs, segment.endMs, stepMs);
  let worst: AngleProtectionHit | null = null;
  let worstExcess = 0;
  for (const timeMs of times) {
    const progress = (timeMs - segment.startMs) / segment.durationMs;
    const pose = poseAtProgress(segment, progress);
    const hit = hitOf(object, pose, timeMs, {
      segmentKey: segment.key,
      ...(segment.ownerPresetBlockId ? { blockId: segment.ownerPresetBlockId } : {}),
    });
    if (!hit) continue;
    const excess = excessOf(hit.pitch, hit.limitMin, hit.limitMax);
    if (excess <= worstExcess) continue;
    worst = hit;
    worstExcess = excess;
  }
  return worst;
};

export const collectAngleProtectionHits = (
  objects: readonly AngleProtectionObject[],
  segments: readonly ResolvedMotionSegment[],
  poses: readonly ResolvedPosePoint[] = [],
  stepMs: number = ANGLE_PROTECTION_SAMPLE_MS,
): AngleProtectionHit[] => {
  const byObject = new Map(
    objects.filter((object) => object.radius > 0).map((object) => [object.objectId, object]),
  );
  const hits: AngleProtectionHit[] = [];

  for (const point of poses) {
    const object = byObject.get(point.objectId);
    if (!object) continue;
    const hit = hitOf(object, point.pose, point.atMs, {
      ...(point.sourceBlockId ? { blockId: point.sourceBlockId } : {}),
    });
    if (hit) hits.push(hit);
  }

  for (const segment of segments) {
    const object = byObject.get(segment.objectId);
    if (!object) continue;
    const hit = checkSegment(object, segment, stepMs);
    if (hit) hits.push(hit);
  }

  return hits;
};
