import type {
  MotionAxisId,
  MotionAxisParams,
  MotionParamsByAxis,
} from "./configuration-types";
import { normalizeAxisDefaultMaxVelocity } from "./virtual-axis-max-velocity";

const round1 = (value: number) => Math.round(value * 10) / 10;

const rateFromSpeedAndTime = (speed: number, timeSec: number): number => {
  if (!Number.isFinite(speed) || !Number.isFinite(timeSec) || timeSec <= 0) return 0;
  return round1(speed / timeSec);
};

/** 由虚轴最大速度 + 最短加减速时间派生最大加减速度（最大加速度 = 最大减速度） */
export const deriveMaxAccelerationFromMaxVelocity = (
  maxVelocity: number,
  minAccelTime: number,
): number => rateFromSpeedAndTime(maxVelocity, minAccelTime);

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

export const normalizeMotionParams = (motionParams: MotionParamsByAxis): MotionParamsByAxis => {
  const next: MotionParamsByAxis = { ...motionParams };
  for (const id of Object.keys(next) as MotionAxisId[]) {
    const params = next[id];
    if (params) next[id] = normalizeAxisDefaultMaxVelocity(id, normalizeMotionAxisParams(params));
  }
  return next;
};
