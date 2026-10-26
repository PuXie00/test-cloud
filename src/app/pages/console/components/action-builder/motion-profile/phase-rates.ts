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

export type RatePhase = "accel" | "decel";

/**
 * 按速度时拖数值、点 ‹ ›：加速度（或减速度）走 steps 档。阶段时间只能是 0.1 s 的整数倍，
 * 所以一档 = 这一段的时间差 0.1 s：steps 为正时间缩短、变化率变大，为负反之。
 * 另一段在 0.1 s 上重新挑时间，让它的变化率尽量保持原值。到头或排不下时返回 null。
 */
export const stepPhaseRate = (input: {
  profile: MotionProfile;
  distance: number;
  durationMs: number;
  boundary?: MotionBoundary;
  phase: RatePhase;
  steps: number;
}): MotionProfile | null => {
  const { profile, distance, durationMs, boundary, phase, steps } = input;
  if (profile.kind !== "trapezoid" || steps === 0) return null;
  const current = trapezoidRatesOf(profile, distance, durationMs, boundary);
  if (!current) return null;
  const { accelMs, decelMs } = profile.params;
  const ownMs = (phase === "accel" ? accelMs : decelMs) - steps * TIME_STEP_MS;
  if (ownMs < TIME_STEP_MS) return null;
  const targetOther = phase === "accel" ? current.deceleration : current.acceleration;
  const build = (otherMs: number): MotionProfile => ({
    kind: "trapezoid",
    params: phase === "accel" ? { accelMs: ownMs, decelMs: otherMs } : { accelMs: otherMs, decelMs: ownMs },
  });
  const errorOf = (otherMs: number): number | null => {
    if (otherMs < TIME_STEP_MS || ownMs + otherMs >= durationMs) return null;
    const rates = trapezoidRatesOf(build(otherMs), distance, durationMs, boundary);
    if (!rates) return null;
    return Math.abs((phase === "accel" ? rates.deceleration : rates.acceleration) - targetOther);
  };
  // 从另一段现在的时间（放不下时先缩到放得下）出发，往误差变小的方向一档一档找
  const otherMs = phase === "accel" ? decelMs : accelMs;
  let bestMs = Math.min(otherMs, Math.floor((durationMs - ownMs - 1) / TIME_STEP_MS) * TIME_STEP_MS);
  let bestError = errorOf(bestMs);
  if (bestError === null) return null;
  for (const direction of [-1, 1]) {
    let ms = bestMs + direction * TIME_STEP_MS;
    let error = errorOf(ms);
    while (error !== null && error < bestError) {
      bestMs = ms;
      bestError = error;
      ms += direction * TIME_STEP_MS;
      error = errorOf(ms);
    }
  }
  return build(bestMs);
};

/**
 * 按时间时点 − +：这一段时间加减 steps 个 0.1 s。少于 0.1 s，或加长后两段变速占满区间时返回 null
 * （已经占满时仍可以缩短）。
 */
export const stepPhaseTime = (
  profile: MotionProfile,
  durationMs: number,
  phase: RatePhase,
  steps: number,
): MotionProfile | null => {
  if (profile.kind !== "trapezoid" || steps === 0) return null;
  const { accelMs, decelMs } = profile.params;
  const ownMs = (phase === "accel" ? accelMs : decelMs) + steps * TIME_STEP_MS;
  const otherMs = phase === "accel" ? decelMs : accelMs;
  if (ownMs < TIME_STEP_MS) return null;
  if (steps > 0 && ownMs + otherMs >= durationMs) return null;
  return {
    kind: "trapezoid",
    params: phase === "accel" ? { accelMs: ownMs, decelMs } : { accelMs, decelMs: ownMs },
  };
};
