import { segmentPoseAt } from "@/app/project/action-sequence/evaluate-sequence";
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
  /** XY 多点摆（多点倾斜）：v2、v3 是 X、Y 两个倾角，按合成倾角 acos(cosX·cosY) 限制 */
  xyTilt?: boolean;
};

export type AngleProtectionHit = {
  objectId: number;
  atMs: number;
  /** 超出允许角度的度数；一段里取最大的采样点 */
  excess: number;
  message: string;
  segmentKey?: string;
  blockId?: string;
};

type AngleViolation = Pick<AngleProtectionHit, "excess" | "message">;

const DEG_TO_RAD = Math.PI / 180;
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

export const formatXyTiltProtectionMessage = (hit: {
  height: number;
  angleX: number;
  angleY: number;
  combined: number;
  limit: number;
}): string =>
  `当前高度 ${formatQty(hit.height)} mm 下虚轴2、虚轴3 合成倾角最大 ${formatQty(hit.limit)}°，` +
  `实际 ${formatQty(hit.combined)}°（虚轴2 ${formatQty(hit.angleX)}°，虚轴3 ${formatQty(hit.angleY)}°）`;

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

/** 平台法向与竖直方向的夹角（°），PLC `_Limit` 的合成倾角 */
export const combinedTiltDeg = (angleX: number, angleY: number): number =>
  Math.acos(
    Math.min(1, Math.max(-1, Math.cos(angleX * DEG_TO_RAD) * Math.cos(angleY * DEG_TO_RAD))),
  ) * RAD_TO_DEG;

const sampleTimesMs = (startMs: number, endMs: number, stepMs: number): number[] => {
  const times: number[] = [];
  for (let time = startMs; time < endMs; time += stepMs) times.push(time);
  times.push(endMs);
  return times;
};

const poseAtProgress = (segment: ResolvedMotionSegment, progress: number): ModelPose =>
  segmentPoseAt(segment, segment.startMs + progress * segment.durationMs);

const pitchViolationOf = (object: AngleProtectionObject, pose: ModelPose): AngleViolation | null => {
  const limits = pitchLimitsAtHeight(pose.v1, object);
  const excess = Math.max(limits.min - pose.v2, pose.v2 - limits.max, 0);
  if (excess <= 1e-9) return null;
  return {
    excess,
    message: formatAngleProtectionMessage({
      height: pose.v1,
      pitch: pose.v2,
      limitMin: limits.min,
      limitMax: limits.max,
    }),
  };
};

const xyTiltViolationOf = (object: AngleProtectionObject, pose: ModelPose): AngleViolation | null => {
  const limit = pitchEnvelopeDeg(pose.v1, object);
  const combined = combinedTiltDeg(pose.v2, pose.v3);
  const excess = combined - limit;
  if (excess <= 1e-9) return null;
  return {
    excess,
    message: formatXyTiltProtectionMessage({
      height: pose.v1,
      angleX: pose.v2,
      angleY: pose.v3,
      combined,
      limit,
    }),
  };
};

const hitOf = (
  object: AngleProtectionObject,
  pose: ModelPose,
  atMs: number,
  extra: { segmentKey?: string; blockId?: string },
): AngleProtectionHit | null => {
  const violation = object.xyTilt ? xyTiltViolationOf(object, pose) : pitchViolationOf(object, pose);
  if (!violation) return null;
  return { objectId: object.objectId, atMs, ...violation, ...extra };
};

const checkSegment = (
  object: AngleProtectionObject,
  segment: ResolvedMotionSegment,
  stepMs: number,
): AngleProtectionHit | null => {
  if (segment.durationMs <= 0) return null;
  const times = sampleTimesMs(segment.startMs, segment.endMs, stepMs);
  let worst: AngleProtectionHit | null = null;
  for (const timeMs of times) {
    const progress = (timeMs - segment.startMs) / segment.durationMs;
    const pose = poseAtProgress(segment, progress);
    const hit = hitOf(object, pose, timeMs, {
      segmentKey: segment.key,
      ...(segment.ownerPresetBlockId ? { blockId: segment.ownerPresetBlockId } : {}),
    });
    if (!hit || (worst && hit.excess <= worst.excess)) continue;
    worst = hit;
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
