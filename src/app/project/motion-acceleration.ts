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

export type MotionAxisLimitRates = Pick<
  MotionAxisParams,
  "maxAcceleration" | "maxDeceleration" | "abnormalDeceleration"
>;

/**
 * 最大加减速度 = 虚轴最大速度 / minAccelTime，异常减速度 = 虚轴最大速度 / emergencyDecelTime。
 * 虚轴最大速度见 virtualAxisMaxVelocityOf；时间单位 s，结果单位 mm/s² 或 °/s²。
 */
export const deriveMotionAxisLimitRates = (
  maxVelocity: number,
  params: Pick<MotionAxisParams, "minAccelTime" | "emergencyDecelTime">,
): MotionAxisLimitRates => {
  const max = deriveMaxAccelerationFromMaxVelocity(maxVelocity, params.minAccelTime);
  return {
    maxAcceleration: max,
    maxDeceleration: max,
    abnormalDeceleration: rateFromSpeedAndTime(maxVelocity, params.emergencyDecelTime),
  };
};

/** 由速度 + 加减速时间派生加减速度（加速度 = 减速度） */
export const deriveMotionAxisAccelerations = (
  params: Pick<MotionAxisParams, "speed" | "accelTime">,
): Pick<MotionAxisParams, "acceleration" | "deceleration"> => {
  const normal = rateFromSpeedAndTime(params.speed, params.accelTime);
  return { acceleration: normal, deceleration: normal };
};

/**
 * 重算加减速度；给了虚轴最大速度时一并重算最大加减速度和异常减速度，
 * 没给时保留原值（落盘时按绑定驱动单元重算，见 setup-persist）。
 */
export const normalizeMotionAxisParams = (
  params: MotionAxisParams,
  maxVelocity?: number,
): MotionAxisParams => ({
  ...params,
  ...deriveMotionAxisAccelerations(params),
  ...(maxVelocity !== undefined ? deriveMotionAxisLimitRates(maxVelocity, params) : {}),
});

export const normalizeMotionParams = (
  motionParams: MotionParamsByAxis,
  maxVelocityByAxis?: Partial<Record<MotionAxisId, number>>,
): MotionParamsByAxis => {
  const next: MotionParamsByAxis = { ...motionParams };
  for (const id of Object.keys(next) as MotionAxisId[]) {
    const params = next[id];
    if (params) {
      next[id] = normalizeAxisDefaultMaxVelocity(
        id,
        normalizeMotionAxisParams(params, maxVelocityByAxis?.[id]),
      );
    }
  }
  return next;
};
