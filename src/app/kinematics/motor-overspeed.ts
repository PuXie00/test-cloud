import { interpolatePoseWithProfiles } from "@/app/project/action-sequence/evaluate-sequence";
import type { ModelPose } from "@/app/project/action-sequence/types";
import type { ResolvedMotionSegment } from "@/app/project/action-sequence/resolve-sequence";
import { solveMultiPointForward, type Vec3 } from "./multi-point-forward";

/** 稀疏采样步长（ms）。覆盖几何非线性峰值，避免 20ms 全量差分。 */
export const MOTOR_OVERSPEED_SAMPLE_MS = 100;

export type MotorOverspeedMotor = {
  id: number;
  name: string;
  maxAxisVelocity: number;
};

export type MotorOverspeedObject = {
  objectId: number;
  pointInitPos: readonly Vec3[];
  baseHeight1: number;
  baseHeight2: number;
  maxHeight: number;
  betaInit: number;
  motors: readonly MotorOverspeedMotor[];
};

export type MotorOverspeedHit = {
  objectId: number;
  motorId: number;
  motorName: string;
  segmentKey: string;
  atMs: number;
  peakVelocity: number;
  limitVelocity: number;
  overspeedRatio: number;
  suggestedDurationMs: number;
  message: string;
};

const poseAtProgress = (segment: ResolvedMotionSegment, progress: number): ModelPose =>
  interpolatePoseWithProfiles(
    segment.fromPose,
    segment.toPose,
    segment.settings.profiles,
    progress,
    segment.durationMs,
  );

const ropeLengthsAt = (object: MotorOverspeedObject, pose: ModelPose): number[] =>
  solveMultiPointForward({
    height: pose.v1,
    roll: pose.v3,
    pitch: pose.v2,
    pointInitPos: object.pointInitPos,
    baseHeight1: object.baseHeight1,
    baseHeight2: object.baseHeight2,
    maxHeight: object.maxHeight,
    betaInit: object.betaInit,
  });

const sampleTimesMs = (startMs: number, endMs: number, stepMs: number): number[] => {
  const times: number[] = [];
  for (let time = startMs; time < endMs; time += stepMs) times.push(time);
  times.push(endMs);
  return times;
};

const formatMmPerSec = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

const formatSec = (ms: number): string => (ms / 1000).toFixed(2);

export const formatMotorOverspeedMessage = (hit: {
  motorName: string;
  atMs: number;
  peakVelocity: number;
  limitVelocity: number;
  suggestedDurationMs: number;
}): string => {
  const overspeedPct = Math.round((hit.peakVelocity / hit.limitVelocity - 1) * 100);
  return (
    `吊点电机 [${hit.motorName}] 在 t = ${formatSec(hit.atMs)}s 处叠加线速度达到 ` +
    `${formatMmPerSec(hit.peakVelocity)} mm/s，超过电机限速 ${formatMmPerSec(hit.limitVelocity)} mm/s` +
    `（超速 ${overspeedPct}%）。建议将本段时长延长至 ${formatSec(hit.suggestedDurationMs)}s`
  );
};

const checkSegmentMotors = (
  object: MotorOverspeedObject,
  segment: ResolvedMotionSegment,
  stepMs: number,
): MotorOverspeedHit[] => {
  if (segment.durationMs <= 0) return [];
  if (object.motors.length === 0 || object.pointInitPos.length === 0) return [];

  const times = sampleTimesMs(segment.startMs, segment.endMs, stepMs);
  const peaks = object.motors.map((motor) => ({
    motor,
    peakVelocity: 0,
    atMs: segment.startMs,
  }));

  let previousLengths: number[] | null = null;
  let previousMs = times[0] ?? segment.startMs;

  for (const timeMs of times) {
    const progress = (timeMs - segment.startMs) / segment.durationMs;
    const lengths = ropeLengthsAt(object, poseAtProgress(segment, progress));
    if (previousLengths) {
      const dtSec = (timeMs - previousMs) / 1000;
      if (dtSec > 0) {
        for (let index = 0; index < peaks.length; index += 1) {
          const previous = previousLengths[index];
          const current = lengths[index];
          if (previous === undefined || current === undefined) continue;
          const speed = Math.abs(current - previous) / dtSec;
          const peak = peaks[index]!;
          if (speed > peak.peakVelocity) {
            peak.peakVelocity = speed;
            peak.atMs = timeMs;
          }
        }
      }
    }
    previousLengths = lengths;
    previousMs = timeMs;
  }

  const hits: MotorOverspeedHit[] = [];
  for (const peak of peaks) {
    const limit = peak.motor.maxAxisVelocity;
    if (!(limit > 0) || peak.peakVelocity <= limit) continue;
    const overspeedRatio = peak.peakVelocity / limit;
    const suggestedDurationMs = Math.ceil(segment.durationMs * overspeedRatio);
    const draft = {
      motorName: peak.motor.name,
      atMs: peak.atMs,
      peakVelocity: peak.peakVelocity,
      limitVelocity: limit,
      suggestedDurationMs,
    };
    hits.push({
      objectId: object.objectId,
      motorId: peak.motor.id,
      motorName: peak.motor.name,
      segmentKey: segment.key,
      atMs: peak.atMs,
      peakVelocity: peak.peakVelocity,
      limitVelocity: limit,
      overspeedRatio,
      suggestedDurationMs,
      message: formatMotorOverspeedMessage(draft),
    });
  }
  return hits;
};

export const collectMotorOverspeedHits = (
  objects: readonly MotorOverspeedObject[],
  segments: readonly ResolvedMotionSegment[],
  stepMs: number = MOTOR_OVERSPEED_SAMPLE_MS,
): MotorOverspeedHit[] => {
  const byObject = new Map(objects.map((object) => [object.objectId, object]));
  const hits: MotorOverspeedHit[] = [];
  for (const segment of segments) {
    const object = byObject.get(segment.objectId);
    if (!object) continue;
    hits.push(...checkSegmentMotors(object, segment, stepMs));
  }
  return hits;
};
