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
