import {
  boundaryTrapezoidOf,
  calculateMotionProfileKinematics,
  hasMotionBoundary,
  trapezoidFromRates,
  type MotionBoundary,
} from "@/app/project/action-sequence/motion-profile";
import type { MotionProfile } from "@/app/project/action-sequence/types";
import { TIME_STEP_MS, snapTimeMs } from "../timeline/timeline-data";

/**
 * 阶段的填法：按时间填加减速时间（区间时长不变）；按速度填加速度、匀速速度、减速度，
 * 区间时长跟着算，终点和后面的块一起挪
 */
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

export const SPEED_UNREACHABLE_MESSAGE = "行程太短，按这组加减速度到不了这个匀速速度";

export type RatePhase = "accel" | "decel";

/** 按速度改出来的曲线和这段曲线的新时长 */
export type RetimedProfile = { profile: MotionProfile; durationMs: number };

const relativeError = (actual: number, target: number): number =>
  Math.abs(actual - target) / target;

/**
 * 按速度：加速度、匀速速度、减速度按所填的走，行程和进出速度不变，求这段的时长。
 * 时长和两段变速时间都要落在 0.1 s 上：在精确时长附近的几档里挑三个值最接近所填的。
 * 行程太短到不了这个匀速速度，或取整后排不下时返回 null。
 */
export const retimeFromRates = (input: {
  distance: number;
  boundary?: MotionBoundary;
  acceleration: number;
  cruiseSpeed: number;
  deceleration: number;
}): RetimedProfile | null => {
  const { distance, boundary, acceleration, cruiseSpeed, deceleration } = input;
  const vs = boundary?.startSpeed ?? 0;
  const ve = boundary?.endSpeed ?? 0;
  if (![distance, acceleration, cruiseSpeed, deceleration, vs, ve].every(Number.isFinite)) return null;
  if (!(distance > 0) || !(acceleration > 0) || !(cruiseSpeed > 0) || !(deceleration > 0)) return null;
  const accelSec = Math.abs(cruiseSpeed - vs) / acceleration;
  const decelSec = Math.abs(cruiseSpeed - ve) / deceleration;
  const cruiseDistance =
    distance - ((vs + cruiseSpeed) / 2) * accelSec - ((cruiseSpeed + ve) / 2) * decelSec;
  if (cruiseDistance < -1e-9 * distance) return null;
  const exactSteps =
    ((accelSec + Math.max(0, cruiseDistance) / cruiseSpeed + decelSec) * 1000) / TIME_STEP_MS;
  // 下取整、上取整，再往上两档：两段变速至少各 0.1 s、中间还要有匀速，很短的区间要多留一点
  const first = Math.max(1, Math.floor(exactSteps));
  let best: { result: RetimedProfile; error: number } | null = null;
  for (let steps = first; steps <= Math.ceil(exactSteps) + 2; steps += 1) {
    const durationMs = steps * TIME_STEP_MS;
    const profile = profileFromRates({ distance, durationMs, boundary, acceleration, deceleration });
    if (profile?.kind !== "trapezoid") continue;
    if (profile.params.accelMs + profile.params.decelMs >= durationMs) continue;
    const rates = trapezoidRatesOf(profile, distance, durationMs, boundary);
    if (!rates) continue;
    const error = Math.max(
      relativeError(rates.acceleration, acceleration),
      relativeError(rates.cruiseSpeed, cruiseSpeed),
      relativeError(rates.deceleration, deceleration),
    );
    if (best === null || error < best.error) best = { result: { profile, durationMs }, error };
  }
  return best?.result ?? null;
};

/**
 * 按速度点加速度（或减速度）的 − +：一档 = 这段变速时间差 0.1 s（steps 为正时变短、变化率变大），
 * 匀速速度和另一段的变化率不变，时长跟着算。到头或排不下时返回 null。
 */
export const stepRetimedRate = (input: {
  profile: MotionProfile;
  distance: number;
  durationMs: number;
  boundary?: MotionBoundary;
  phase: RatePhase;
  steps: number;
}): RetimedProfile | null => {
  const { profile, distance, durationMs, boundary, phase, steps } = input;
  if (profile.kind !== "trapezoid" || steps === 0) return null;
  const current = trapezoidRatesOf(profile, distance, durationMs, boundary);
  if (!current) return null;
  const ownMs = (phase === "accel" ? profile.params.accelMs : profile.params.decelMs) - steps * TIME_STEP_MS;
  if (ownMs < TIME_STEP_MS) return null;
  const edgeSpeed = phase === "accel" ? (boundary?.startSpeed ?? 0) : (boundary?.endSpeed ?? 0);
  const rate = Math.abs(current.cruiseSpeed - edgeSpeed) / (ownMs / 1000);
  if (!(rate > 0)) return null;
  return retimeFromRates({
    distance,
    boundary,
    acceleration: phase === "accel" ? rate : current.acceleration,
    cruiseSpeed: current.cruiseSpeed,
    deceleration: phase === "decel" ? rate : current.deceleration,
  });
};

/**
 * 按速度点匀速速度的 − +：一档 = 时长差 0.1 s（steps 为正时变短、更快），加减速度不变。
 * 排不下时返回 null。
 */
export const stepRetimedSpeed = (input: {
  profile: MotionProfile;
  distance: number;
  durationMs: number;
  boundary?: MotionBoundary;
  steps: number;
}): RetimedProfile | null => {
  const { profile, distance, durationMs, boundary, steps } = input;
  if (profile.kind !== "trapezoid" || steps === 0) return null;
  const current = trapezoidRatesOf(profile, distance, durationMs, boundary);
  if (!current) return null;
  const nextMs = durationMs - steps * TIME_STEP_MS;
  if (nextMs < TIME_STEP_MS) return null;
  const next = profileFromRates({
    distance,
    durationMs: nextMs,
    boundary,
    acceleration: current.acceleration,
    deceleration: current.deceleration,
  });
  if (next?.kind !== "trapezoid" || next.params.accelMs + next.params.decelMs >= nextMs) return null;
  return { profile: next, durationMs: nextMs };
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
