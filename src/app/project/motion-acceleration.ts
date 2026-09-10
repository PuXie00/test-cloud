import type { MotionAxisKind, MotionAxisParams } from "./configuration-types";

const round1 = (value: number) => Math.round(value * 10) / 10;

const rateFromSpeedAndTime = (speed: number, timeSec: number): number => {
  if (!Number.isFinite(speed) || !Number.isFinite(timeSec) || timeSec <= 0) return 0;
  return round1(speed / timeSec);
};

/** 由速度 + 加减速时间派生加减速度（加速度 = 减速度） */
export const deriveMotionAxisAccelerations = (
  params: Pick<MotionAxisParams, "speed" | "accelTime" | "minAccelTime" | "emergencyDecelTime">,
): Pick<
  MotionAxisParams,
  "acceleration" | "deceleration" | "maxAcceleration" | "maxDeceleration" | "abnormalDeceleration"
> => {
  const normal = rateFromSpeedAndTime(params.speed, params.accelTime);
  const max = rateFromSpeedAndTime(params.speed, params.minAccelTime);
  const abnormal = rateFromSpeedAndTime(params.speed, params.emergencyDecelTime);
  return {
    acceleration: normal,
    deceleration: normal,
    maxAcceleration: max,
    maxDeceleration: max,
    abnormalDeceleration: abnormal,
  };
};

export const normalizeMotionAxisParams = (params: MotionAxisParams): MotionAxisParams => ({
  ...params,
  ...deriveMotionAxisAccelerations(params),
});

export const normalizeMotionParams = (
  motionParams: Partial<Record<MotionAxisKind, MotionAxisParams>>,
): Partial<Record<MotionAxisKind, MotionAxisParams>> => {
  const next: Partial<Record<MotionAxisKind, MotionAxisParams>> = { ...motionParams };
  for (const axis of Object.keys(next) as MotionAxisKind[]) {
    const params = next[axis];
    if (params) next[axis] = normalizeMotionAxisParams(params);
  }
  return next;
};
