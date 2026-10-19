import {
  boundaryTrapezoidOf,
  calculateMotionProfileKinematics,
  hasMotionBoundary,
  trapezoidFromRates,
  type MotionBoundary,
} from "@/app/project/action-sequence/motion-profile";
import type { MotionProfile } from "@/app/project/action-sequence/types";
import { TIME_STEP_MS, snapTimeMs } from "../timeline/timeline-data";

/** 阶段的填法：按时间填加减速时间，或按速度填加减速度（区间时长都不变） */
export type PhaseInputMode = "time" | "speed";

export const PHASE_INPUT_MODE_TABS: ReadonlyArray<{ id: PhaseInputMode; label: string }> = [
  { id: "time", label: "按时间" },
  { id: "speed", label: "按速度" },
];

export type PhaseRates = {
  acceleration: number;
  cruiseSpeed: number;
  deceleration: number;
};

/** 梯形现在的加速度、匀速速度、减速度；没有行程或曲线放不下时为 null */
export const trapezoidRatesOf = (
  profile: MotionProfile,
  distance: number,
  durationMs: number,
  boundary?: MotionBoundary,
): PhaseRates | null => {
  if (profile.kind !== "trapezoid" || !(distance > 0) || !(durationMs > 0)) return null;
  if (boundary && hasMotionBoundary(boundary)) {
    const shape = boundaryTrapezoidOf(profile, distance, durationMs, boundary);
    if (!shape) return null;
    return {
      acceleration: Math.abs(shape.cruiseSpeed - shape.startSpeed) / shape.accelSec,
      cruiseSpeed: shape.cruiseSpeed,
      deceleration: Math.abs(shape.cruiseSpeed - shape.endSpeed) / shape.decelSec,
    };
  }
  try {
    const kinematics = calculateMotionProfileKinematics(profile, distance, durationMs);
    return {
      acceleration: kinematics.acceleration,
      cruiseSpeed: kinematics.peakVelocity,
      deceleration: kinematics.deceleration,
    };
  } catch {
    return null;
  }
};

const RATE_SLACK = 1 + 1e-9;

/** 阶段时间取整的两个候选：向下、向上到 0.1 s，至少 0.1 s */
const roundingCandidates = (sec: number): number[] => {
  const steps = (sec * 1000) / TIME_STEP_MS;
  return [...new Set([Math.floor(steps), Math.ceil(steps)].map((n) => Math.max(1, n) * TIME_STEP_MS))];
};

/**
 * 按加减速度算出的梯形。阶段时间要落在 0.1 s（PLC 精度）上，至少 0.1 s：
 * 在上下取整的组合里挑算出来的加减速度最接近所填值的，优先不超过所填值。
 * 加减速度排不下时返回 null。
 */
export const profileFromRates = (input: {
  distance: number;
  durationMs: number;
  boundary?: MotionBoundary;
  acceleration: number;
  deceleration: number;
}): MotionProfile | null => {
  const exact = trapezoidFromRates(input);
  if (!exact) return null;
  let best: { profile: MotionProfile; exceeds: boolean; error: number } | null = null;
  for (const accelMs of roundingCandidates(exact.accelSec)) {
    for (const decelMs of roundingCandidates(exact.decelSec)) {
      if (accelMs + decelMs >= input.durationMs) continue;
      const profile: MotionProfile = { kind: "trapezoid", params: { accelMs, decelMs } };
      const rates = trapezoidRatesOf(profile, input.distance, input.durationMs, input.boundary);
      if (!rates) continue;
      const exceeds =
        rates.acceleration > input.acceleration * RATE_SLACK ||
        rates.deceleration > input.deceleration * RATE_SLACK;
      const error = Math.max(
        Math.abs(rates.acceleration - input.acceleration) / input.acceleration,
        Math.abs(rates.deceleration - input.deceleration) / input.deceleration,
      );
      const better =
        best === null ||
        (best.exceeds && !exceeds) ||
        (best.exceeds === exceeds && error < best.error);
      if (better) best = { profile, exceeds, error };
    }
  }
  if (best) return best.profile;
  // 区间太短，取整后放不下匀速段：仍按最接近的时间写入，和按时间填一样标「需检查」
  return {
    kind: "trapezoid",
    params: {
      accelMs: Math.max(TIME_STEP_MS, snapTimeMs(exact.accelSec * 1000)),
      decelMs: Math.max(TIME_STEP_MS, snapTimeMs(exact.decelSec * 1000)),
    },
  };
};

export const RATES_DO_NOT_FIT_MESSAGE = "加减速度太小或进出速度太快，这段时间里排不下";
