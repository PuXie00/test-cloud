import {
  calculateMotionProfileKinematics,
  createDefaultAxisProfile,
} from "./motion-profile";
import { getPresetDefinition } from "./preset-registry";
import type { PresetParamValue } from "./types";

export const PRESET_DEFAULT_DURATION_MS = 3000;
export const PRESET_TIME_STEP_MS = 100;

export type AxisRange = { min: number; max: number };

export type PresetParticipantLimits = {
  id: number;
  rangeByAxis?: Partial<Record<"v1" | "v2" | "v3", AxisRange>>;
  maxSpeedByAxis?: Partial<Record<"v1" | "v2" | "v3", number>>;
  minAccelTimeByAxis?: Partial<Record<"v1" | "v2" | "v3", number>>;
};

export type FittedPresetParams = {
  params: Record<string, PresetParamValue>;
  durationMs: number;
};

const FALLBACK_V1: AxisRange = { min: 0, max: 1000 };

const isRange = (value: AxisRange | undefined): value is AxisRange =>
  value !== undefined && Number.isFinite(value.min) && Number.isFinite(value.max) && value.min <= value.max;

const intersectRanges = (ranges: AxisRange[]): AxisRange | undefined => {
  if (ranges.length === 0) return undefined;
  const min = Math.max(...ranges.map((range) => range.min));
  const max = Math.min(...ranges.map((range) => range.max));
  if (min > max) return undefined;
  return { min, max };
};

const rangeOf = (
  participants: readonly PresetParticipantLimits[],
  axis: "v1" | "v2" | "v3",
  fallback: AxisRange,
): AxisRange => {
  const found = participants
    .map((participant) => participant.rangeByAxis?.[axis])
    .filter(isRange);
  return intersectRanges(found) ?? fallback;
};

const midOf = (range: AxisRange): number => (range.min + range.max) / 2;

const clampTo = (value: number, range: AxisRange): number =>
  Math.min(range.max, Math.max(range.min, value));

const snapMs = (ms: number): number =>
  Math.max(PRESET_TIME_STEP_MS, Math.round(ms / PRESET_TIME_STEP_MS) * PRESET_TIME_STEP_MS);

const preferredAmplitude = (range: AxisRange, requested = 100): number => {
  const span = range.max - range.min;
  if (span <= 0) return 0;
  return Math.min(requested, span * 0.4);
};

const minAccelSecOf = (participants: readonly PresetParticipantLimits[]): number | undefined => {
  let max: number | undefined;
  for (const participant of participants) {
    const value = participant.minAccelTimeByAxis?.v1;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    max = max === undefined ? value : Math.max(max, value);
  }
  return max;
};

const maxVelocityOf = (participants: readonly PresetParticipantLimits[]): number | undefined => {
  let min: number | undefined;
  for (const participant of participants) {
    const value = participant.maxSpeedByAxis?.v1;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    min = min === undefined ? value : Math.min(min, value);
  }
  return min;
};

const durationForPhases = (minAccelSec: number | undefined, intervals = 1): number => {
  const minPhaseMs =
    minAccelSec !== undefined && minAccelSec > 0 ? minAccelSec * 1000 : 0.2 * PRESET_DEFAULT_DURATION_MS;
  const minInterval = 2 * minPhaseMs + PRESET_TIME_STEP_MS;
  return snapMs(Math.max(PRESET_DEFAULT_DURATION_MS, intervals * minInterval));
};

const maxTravelFor = (durationMs: number, minAccelSec: number | undefined, maxVelocity: number | undefined): number => {
  if (maxVelocity === undefined) return Number.POSITIVE_INFINITY;
  const profile = createDefaultAxisProfile(durationMs, minAccelSec);
  try {
    const metrics = calculateMotionProfileKinematics(profile, 1, durationMs);
    if (metrics.peakVelocity <= 0) return 0;
    return maxVelocity / metrics.peakVelocity;
  } catch {
    return 0;
  }
};

const centeredSpan = (range: AxisRange, travel: number): { start: number; end: number } => {
  const half = travel / 2;
  let start = midOf(range) - half;
  let end = midOf(range) + half;
  if (start < range.min) {
    end += range.min - start;
    start = range.min;
  }
  if (end > range.max) {
    start -= end - range.max;
    end = range.max;
  }
  return {
    start: clampTo(start, range),
    end: clampTo(end, range),
  };
};

export const fitPresetParams = (
  presetId: string,
  participants: readonly PresetParticipantLimits[] = [],
): FittedPresetParams | null => {
  const definition = getPresetDefinition(presetId);
  if (!definition) return null;

  const v1 = rangeOf(participants, "v1", FALLBACK_V1);
  const count = Math.max(participants.length, 2);
  const minAccelSec = minAccelSecOf(participants);
  const maxVelocity = maxVelocityOf(participants);

  if (presetId === "static-flat") {
    return { durationMs: PRESET_DEFAULT_DURATION_MS, params: { v1: midOf(v1) } };
  }

  if (presetId === "static-slope") {
    const span = v1.max - v1.min;
    const stepV1 = count <= 1 ? 0 : Math.min(100, span / Math.max(1, count - 1));
    const occupied = stepV1 * (count - 1);
    const baseV1 = v1.min + (span - occupied) / 2;
    return { durationMs: PRESET_DEFAULT_DURATION_MS, params: { baseV1, stepV1 } };
  }

  if (presetId === "static-arc") {
    const amplitude = preferredAmplitude(v1);
    const baseV1 = midOf(v1) - amplitude / 2;
    return { durationMs: PRESET_DEFAULT_DURATION_MS, params: { baseV1, amplitude } };
  }

  if (presetId === "static-wave") {
    const amplitude = preferredAmplitude(v1);
    return {
      durationMs: PRESET_DEFAULT_DURATION_MS,
      params: { baseV1: midOf(v1), amplitude, phaseDeg: 0, intervalDeg: 90 },
    };
  }

  if (presetId === "dynamic-level") {
    const durationMs = durationForPhases(minAccelSec, 1);
    const travelCap = Math.min(preferredAmplitude(v1) * 2, maxTravelFor(durationMs, minAccelSec, maxVelocity));
    const travel = Math.max(0, travelCap);
    const { start, end } = centeredSpan(v1, travel);
    return {
      durationMs,
      params: { startV1: start, targetV1: end },
    };
  }

  if (presetId === "dynamic-wave") {
    const durationMs = durationForPhases(minAccelSec, 3);
    const sampleIntervalMs = snapMs(durationMs / 3);
    const travelCap = maxTravelFor(sampleIntervalMs, minAccelSec, maxVelocity);
    const amplitude = Math.min(preferredAmplitude(v1), travelCap / 2);
    return {
      durationMs,
      params: {
        baseV1: midOf(v1),
        amplitude: Math.max(0, amplitude),
        cycles: 1,
        direction: 1,
        intervalDeg: 90,
        sampleIntervalMs,
      },
    };
  }

  return null;
};
