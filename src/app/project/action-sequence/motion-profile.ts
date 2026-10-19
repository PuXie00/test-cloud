import type { AxisMotionProfiles, IdleAxisProfile, MotionProfile, TrapezoidAxisProfile } from "./types";

export type MotionProfileKinematics = {
  peakVelocity: number;
  acceleration: number;
  deceleration: number;
  accelDurationSec: number;
  cruiseDurationSec: number;
  decelDurationSec: number;
};

const TRAPEZOID_EPSILON_MS = 1e-4;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const clampMs = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const idleKinematics = (durationMs: number): MotionProfileKinematics => ({
  peakVelocity: 0,
  acceleration: 0,
  deceleration: 0,
  accelDurationSec: 0,
  cruiseDurationSec: durationMs > 0 ? durationMs / 1000 : 0,
  decelDurationSec: 0,
});

export const createIdleAxisProfile = (): IdleAxisProfile => ({ kind: "idle" });

export const syncAxisProfileToTravel = (
  profile: MotionProfile,
  travel: number,
  durationMs: number,
  minAccelTimeSec?: number,
): MotionProfile => {
  if (travel === 0) return createIdleAxisProfile();
  if (profile.kind === "idle") {
    return createDefaultAxisProfile(durationMs, minAccelTimeSec);
  }
  return profile;
};

export const cruiseMsOf = (profile: MotionProfile, durationMs: number): number => {
  if (profile.kind === "idle") return durationMs;
  return durationMs - profile.params.accelMs - profile.params.decelMs;
};

export const ratiosFromProfile = (
  profile: MotionProfile,
  durationMs: number,
): { accelRatio: number; decelRatio: number } | null => {
  if (profile.kind !== "trapezoid" || durationMs <= 0) return null;
  return {
    accelRatio: profile.params.accelMs / durationMs,
    decelRatio: profile.params.decelMs / durationMs,
  };
};

export const createDefaultAxisProfile = (
  durationMs: number,
  minAccelTimeSec?: number,
): TrapezoidAxisProfile => {
  const ms =
    minAccelTimeSec !== undefined &&
    Number.isFinite(minAccelTimeSec) &&
    minAccelTimeSec > 0
      ? minAccelTimeSec * 1000
      : durationMs > 0
        ? 0.2 * durationMs
        : 1;
  return {
    kind: "trapezoid",
    params: { accelMs: ms, decelMs: ms },
  };
};

export const createDefaultAxisProfiles = (
  durationMs: number,
  minAccelTimeByAxis?: Partial<Record<"v1" | "v2" | "v3", number>>,
): AxisMotionProfiles => ({
  v1: createDefaultAxisProfile(durationMs, minAccelTimeByAxis?.v1),
  v2: createDefaultAxisProfile(durationMs, minAccelTimeByAxis?.v2),
  v3: createDefaultAxisProfile(durationMs, minAccelTimeByAxis?.v3),
});

export const cloneMotionProfile = (profile: MotionProfile): MotionProfile => {
  if (profile.kind === "idle") return { kind: "idle" };
  return { kind: "trapezoid", params: { ...profile.params } };
};

export const cloneAxisProfiles = (profiles: AxisMotionProfiles): AxisMotionProfiles => ({
  v1: cloneMotionProfile(profiles.v1),
  v2: cloneMotionProfile(profiles.v2),
  v3: cloneMotionProfile(profiles.v3),
});

export const validateMotionProfile = (profile: MotionProfile): string[] => {
  if (profile.kind === "idle") return [];
  const { accelMs, decelMs } = profile.params;
  const errors: string[] = [];
  if (!Number.isFinite(accelMs) || accelMs <= 0) {
    errors.push("accelMs must be finite and greater than 0");
  }
  if (!Number.isFinite(decelMs) || decelMs <= 0) {
    errors.push("decelMs must be finite and greater than 0");
  }
  return errors;
};

const trapezoidPeakFactor = (accelRatio: number, decelRatio: number): number =>
  1 / (1 - (accelRatio + decelRatio) / 2);

const assertLegalCruiseRatios = (
  profile: MotionProfile,
  durationMs: number,
): { accelRatio: number; decelRatio: number } | null => {
  if (profile.kind !== "trapezoid") return null;
  const ratios = ratiosFromProfile(profile, durationMs);
  if (
    !ratios ||
    validateMotionProfile(profile).length > 0 ||
    profile.params.accelMs + profile.params.decelMs > durationMs
  ) {
    return null;
  }
  return ratios;
};

export const sampleVelocityNorm = (
  profile: MotionProfile,
  tNorm: number,
  durationMs: number,
): number => {
  if (profile.kind === "idle") return 0;
  if (profile.kind !== "trapezoid") {
    throw new Error("unsupported motion profile kind");
  }
  const ratios = ratiosFromProfile(profile, durationMs);
  if (!ratios) {
    throw new Error("invalid trapezoid motion profile");
  }
  const t = clamp01(tNorm);
  const { accelRatio, decelRatio } = ratios;
  if (t <= accelRatio) {
    return t / accelRatio;
  }
  if (t < 1 - decelRatio) {
    return 1;
  }
  return (1 - t) / decelRatio;
};

export const trapezoidHandles = (
  profile: MotionProfile,
  durationMs: number,
): ReadonlyArray<{ id: "accel-end" | "decel-start"; tNorm: number }> => {
  const ratios = ratiosFromProfile(profile, durationMs);
  return [
    { id: "accel-end", tNorm: ratios?.accelRatio ?? 0 },
    { id: "decel-start", tNorm: ratios ? 1 - ratios.decelRatio : 1 },
  ];
};

export const applyTrapezoidHandleDrag = (
  profile: MotionProfile,
  handleId: "accel-end" | "decel-start",
  nextTNorm: number,
  durationMs: number,
  minAccelMs?: number,
): MotionProfile => {
  if (profile.kind !== "trapezoid") return profile;
  const minMs = Math.max(TRAPEZOID_EPSILON_MS, minAccelMs ?? TRAPEZOID_EPSILON_MS);
  const { accelMs, decelMs } = profile.params;
  const otherMs = handleId === "accel-end" ? decelMs : accelMs;
  const requestedMs =
    handleId === "accel-end" ? nextTNorm * durationMs : (1 - nextTNorm) * durationMs;
  const durationEnough = durationMs > minMs + otherMs + TRAPEZOID_EPSILON_MS;
  const nextMs = durationEnough
    ? clampMs(requestedMs, minMs, durationMs - otherMs - TRAPEZOID_EPSILON_MS)
    : requestedMs;
  if (handleId === "accel-end") {
    return { kind: "trapezoid", params: { accelMs: nextMs, decelMs } };
  }
  return { kind: "trapezoid", params: { accelMs, decelMs: nextMs } };
};

export const withTrapezoidAccelMs = (
  profile: MotionProfile,
  nextAccelMs: number,
): MotionProfile | null => {
  if (profile.kind !== "trapezoid") return null;
  if (!Number.isFinite(nextAccelMs) || nextAccelMs <= 0) return null;
  return {
    kind: "trapezoid",
    params: {
      accelMs: nextAccelMs,
      decelMs: profile.params.decelMs,
    },
  };
};

export const withTrapezoidDecelMs = (
  profile: MotionProfile,
  nextDecelMs: number,
): MotionProfile | null => {
  if (profile.kind !== "trapezoid") return null;
  if (!Number.isFinite(nextDecelMs) || nextDecelMs <= 0) return null;
  return {
    kind: "trapezoid",
    params: {
      accelMs: profile.params.accelMs,
      decelMs: nextDecelMs,
    },
  };
};

export const evaluateMotionProfile = (
  profile: MotionProfile,
  normalizedTime: number,
  durationMs: number,
): number => {
  if (profile.kind === "idle") return 0;
  const ratios = assertLegalCruiseRatios(profile, durationMs);
  if (!ratios) {
    throw new Error("invalid trapezoid motion profile");
  }
  const progress = clamp01(normalizedTime);
  if (progress === 0 || progress === 1) return progress;

  const { accelRatio, decelRatio } = ratios;
  const cruiseRatio = 1 - accelRatio - decelRatio;
  const peakFactor = trapezoidPeakFactor(accelRatio, decelRatio);

  if (progress <= accelRatio) {
    return (peakFactor * progress * progress) / (2 * accelRatio);
  }
  if (progress < 1 - decelRatio) {
    return peakFactor * (progress - accelRatio / 2);
  }

  const decelProgress = progress - (1 - decelRatio);
  return peakFactor * (
    accelRatio / 2 +
    cruiseRatio +
    decelProgress -
    (decelProgress * decelProgress) / (2 * decelRatio)
  );
};

export const motionProfilePhaseBoundaries = (
  profile: MotionProfile,
  durationMs: number,
): number[] => {
  const ratios = ratiosFromProfile(profile, durationMs);
  if (!ratios) return [];
  return [ratios.accelRatio, 1 - ratios.decelRatio];
};

export const calculateMotionProfileKinematics = (
  profile: MotionProfile,
  distance: number,
  durationMs: number,
): MotionProfileKinematics => {
  if (profile.kind === "idle") return idleKinematics(durationMs);
  const ratios = assertLegalCruiseRatios(profile, durationMs);
  if (!ratios) {
    throw new Error("motion profile and duration must be valid");
  }
  const durationSec = durationMs / 1000;
  const absoluteDistance = Math.abs(distance);
  const { accelRatio, decelRatio } = ratios;
  const cruiseRatio = 1 - accelRatio - decelRatio;
  const peakFactor = trapezoidPeakFactor(accelRatio, decelRatio);
  return {
    peakVelocity: absoluteDistance * peakFactor / durationSec,
    acceleration: absoluteDistance * peakFactor / (accelRatio * durationSec * durationSec),
    deceleration: absoluteDistance * peakFactor / (decelRatio * durationSec * durationSec),
    accelDurationSec: accelRatio * durationSec,
    cruiseDurationSec: cruiseRatio * durationSec,
    decelDurationSec: decelRatio * durationSec,
  };
};

/** 进入、离开这段时的速度（单位/秒，沿行程方向为正）；连续衔接时中间位姿不为 0 */
export type MotionBoundary = { startSpeed: number; endSpeed: number };

export const hasMotionBoundary = (boundary: MotionBoundary | undefined): boolean =>
  boundary !== undefined && (boundary.startSpeed > 0 || boundary.endSpeed > 0);

/** 带进出速度的梯形：段首从 startSpeed 变到匀速，段尾从匀速变到 endSpeed */
export type BoundaryTrapezoid = {
  startSpeed: number;
  cruiseSpeed: number;
  endSpeed: number;
  accelSec: number;
  cruiseSec: number;
  decelSec: number;
};

/** 行程或时长放不下这次变速（匀速算出来不是正数）时返回 null */
export const boundaryTrapezoidOf = (
  profile: MotionProfile,
  distance: number,
  durationMs: number,
  boundary: MotionBoundary,
): BoundaryTrapezoid | null => {
  if (profile.kind !== "trapezoid") return null;
  const totalSec = durationMs / 1000;
  const accelSec = profile.params.accelMs / 1000;
  const decelSec = profile.params.decelMs / 1000;
  if (!(totalSec > 0) || !(accelSec > 0) || !(decelSec > 0) || accelSec + decelSec > totalSec) {
    return null;
  }
  const cruiseSpeed =
    (distance - (accelSec * boundary.startSpeed) / 2 - (decelSec * boundary.endSpeed) / 2) /
    (totalSec - accelSec / 2 - decelSec / 2);
  if (!Number.isFinite(cruiseSpeed) || cruiseSpeed <= 0) return null;
  return {
    startSpeed: boundary.startSpeed,
    cruiseSpeed,
    endSpeed: boundary.endSpeed,
    accelSec,
    cruiseSec: totalSec - accelSec - decelSec,
    decelSec,
  };
};

/** 从这段起点走过的距离 */
export const boundaryTrapezoidDistanceAt = (shape: BoundaryTrapezoid, sec: number): number => {
  const { startSpeed, cruiseSpeed, endSpeed, accelSec, cruiseSec, decelSec } = shape;
  const t = Math.min(Math.max(sec, 0), accelSec + cruiseSec + decelSec);
  if (t <= accelSec) return startSpeed * t + ((cruiseSpeed - startSpeed) * t * t) / (2 * accelSec);
  const accelDistance = (accelSec * (startSpeed + cruiseSpeed)) / 2;
  if (t <= accelSec + cruiseSec) return accelDistance + cruiseSpeed * (t - accelSec);
  const u = t - accelSec - cruiseSec;
  return (
    accelDistance +
    cruiseSpeed * cruiseSec +
    cruiseSpeed * u -
    ((cruiseSpeed - endSpeed) * u * u) / (2 * decelSec)
  );
};

export const boundaryTrapezoidSpeedAt = (shape: BoundaryTrapezoid, sec: number): number => {
  const { startSpeed, cruiseSpeed, endSpeed, accelSec, cruiseSec, decelSec } = shape;
  const t = Math.min(Math.max(sec, 0), accelSec + cruiseSec + decelSec);
  if (t <= accelSec) return startSpeed + ((cruiseSpeed - startSpeed) * t) / accelSec;
  if (t <= accelSec + cruiseSec) return cruiseSpeed;
  return cruiseSpeed - ((cruiseSpeed - endSpeed) * (t - accelSec - cruiseSec)) / decelSec;
};

/** 按加减速度反推出的梯形：匀速速度和两段变速各自的时长 */
export type TrapezoidFromRates = { cruiseSpeed: number; accelSec: number; decelSec: number };

/** 二分求单调函数的根，lo、hi 两端已经夹住 */
const bisect = (fn: (x: number) => number, lo: number, hi: number): number => {
  let low = lo;
  let high = hi;
  for (let step = 0; step < 100; step += 1) {
    const mid = (low + high) / 2;
    if (fn(mid) < 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
};

/**
 * 按加减速度反推梯形：时长、行程和进出速度都不变，求匀速速度和两段变速的时长。
 * 加减速度太小（这段时间里走不完或变不过来），或进出速度太快收不住时返回 null。
 */
export const trapezoidFromRates = (input: {
  distance: number;
  durationMs: number;
  boundary?: MotionBoundary;
  acceleration: number;
  deceleration: number;
}): TrapezoidFromRates | null => {
  const totalSec = input.durationMs / 1000;
  const { distance, acceleration: a, deceleration: d } = input;
  const vs = input.boundary?.startSpeed ?? 0;
  const ve = input.boundary?.endSpeed ?? 0;
  if (![totalSec, distance, a, d, vs, ve].every(Number.isFinite)) return null;
  if (!(totalSec > 0) || !(distance > 0) || !(a > 0) || !(d > 0) || vs < 0 || ve < 0) return null;
  // 两段变速一共要多久：凸函数，在 vs、ve 中间某处最小
  const rampSec = (vc: number) => Math.abs(vc - vs) / a + Math.abs(vc - ve) / d;
  // 匀速取 vc 时走过的距离；在 rampSec ≤ 总时长的范围内随 vc 单调不减（导数是匀速段时长）
  const covered = (vc: number) =>
    vc * totalSec -
    ((vc - vs) * Math.abs(vc - vs)) / (2 * a) -
    ((vc - ve) * Math.abs(vc - ve)) / (2 * d);
  const lowest = rampSec(vs) <= rampSec(ve) ? vs : ve;
  if (rampSec(lowest) > totalSec) return null;
  const ceiling = Math.max(vs, ve) + totalSec * (a + d);
  const hi = bisect((vc) => rampSec(vc) - totalSec, lowest, ceiling);
  const lo = rampSec(0) <= totalSec ? 0 : bisect((vc) => totalSec - rampSec(vc), 0, lowest);
  if (covered(hi) < distance || covered(lo) > distance) return null;
  const cruiseSpeed = bisect((vc) => covered(vc) - distance, lo, hi);
  if (!(cruiseSpeed > 0)) return null;
  return {
    cruiseSpeed,
    accelSec: Math.abs(cruiseSpeed - vs) / a,
    decelSec: Math.abs(cruiseSpeed - ve) / d,
  };
};

/** 和 calculateMotionProfileKinematics 同形：峰值取三个速度里最大的，加减速度取两段变速的变化率 */
export const boundaryTrapezoidKinematics = (shape: BoundaryTrapezoid): MotionProfileKinematics => ({
  peakVelocity: Math.max(shape.startSpeed, shape.cruiseSpeed, shape.endSpeed),
  acceleration: Math.abs(shape.cruiseSpeed - shape.startSpeed) / shape.accelSec,
  deceleration: Math.abs(shape.cruiseSpeed - shape.endSpeed) / shape.decelSec,
  accelDurationSec: shape.accelSec,
  cruiseDurationSec: shape.cruiseSec,
  decelDurationSec: shape.decelSec,
});
