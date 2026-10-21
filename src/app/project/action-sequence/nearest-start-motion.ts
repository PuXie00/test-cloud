/** 对齐 python/就近计算/就近接入计算.py：零速起止点到点运动、k/k² 缩放、两点/四点正解。 */

export type AxisVad = { velocity: number; acceleration: number; deceleration: number };

export const ZERO_VAD: AxisVad = { velocity: 0, acceleration: 0, deceleration: 0 };

const DEG_TO_RAD = Math.PI / 180;
const DISTANCE_EPSILON = 1e-12;

export type MotionProfileResult = { peak: number; time: number };

/** _minimum_motion_profile：梯形/三角形速度曲线的峰值速度和总时间（秒） */
export const minimumMotionProfile = (
  distance: number,
  velocity: number,
  acceleration: number,
  deceleration: number,
): MotionProfileResult => {
  const travel = Math.abs(distance);
  if (![travel, velocity, acceleration, deceleration].every(Number.isFinite)) {
    throw new Error("位移和V/A/D必须是有限数值");
  }
  if (travel <= DISTANCE_EPSILON) return { peak: 0, time: 0 };
  if (Math.min(velocity, acceleration, deceleration) <= 0) {
    throw new Error("有位移的活动轴速度、加速度、减速度必须都大于0");
  }
  const accelDistance = (velocity * velocity) / (2 * acceleration);
  const decelDistance = (velocity * velocity) / (2 * deceleration);
  if (accelDistance + decelDistance <= travel) {
    const cruise = travel - accelDistance - decelDistance;
    return {
      peak: velocity,
      time: velocity / acceleration + cruise / velocity + velocity / deceleration,
    };
  }
  const peak = Math.sqrt((2 * travel * acceleration * deceleration) / (acceleration + deceleration));
  return { peak, time: peak / acceleration + peak / deceleration };
};

/** _scale_motion_parameters：按时间比例 k 缩放，速度乘 k，加减速度乘 k² */
export const scaleMotionParameters = (vad: AxisVad, scale: number): AxisVad => {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1 + 1e-12) {
    throw new Error("运动参数缩放比例k必须大于0且不超过1");
  }
  const k = Math.min(scale, 1);
  return {
    velocity: vad.velocity * k,
    acceleration: vad.acceleration * k * k,
    deceleration: vad.deceleration * k * k,
  };
};

/** 零速起止梯形/三角形运动在 tSec 时的位置；vad.velocity 为本段实际峰值。 */
export const pointToPointPositionAt = (
  from: number,
  to: number,
  vad: AxisVad,
  tSec: number,
): number => {
  const distance = Math.abs(to - from);
  if (distance <= DISTANCE_EPSILON || vad.velocity <= 0) return tSec > 0 ? to : from;
  const { time } = minimumMotionProfile(distance, vad.velocity, vad.acceleration, vad.deceleration);
  if (tSec <= 0) return from;
  if (tSec >= time) return to;
  const direction = to > from ? 1 : -1;
  const peak = Math.min(
    vad.velocity,
    Math.sqrt((2 * distance * vad.acceleration * vad.deceleration) / (vad.acceleration + vad.deceleration)),
  );
  const accelTime = peak / vad.acceleration;
  const decelTime = peak / vad.deceleration;
  const cruiseTime = Math.max(0, time - accelTime - decelTime);
  let travel: number;
  if (tSec <= accelTime) {
    travel = 0.5 * vad.acceleration * tSec * tSec;
  } else if (tSec <= accelTime + cruiseTime) {
    travel = 0.5 * vad.acceleration * accelTime * accelTime + peak * (tSec - accelTime);
  } else {
    const dt = tSec - accelTime - cruiseTime;
    travel =
      0.5 * vad.acceleration * accelTime * accelTime +
      peak * cruiseTime +
      peak * dt -
      0.5 * vad.deceleration * dt * dt;
  }
  return from + direction * Math.min(distance, travel);
};

export type HpyPose = { h: number; p: number; y: number };

/** liangdian_forward_model：两点正解，返回 [A, B] 电机位置；上下原点都不唯一时返回 null */
export const twoPointForward = (
  height: number,
  argX: number,
  baseHeight1: number,
  baseHeight2: number,
  lengthInside: number,
  maxHeight: number,
): [number, number] | null => {
  const half = lengthInside / 2;
  if (baseHeight1 !== 0 && baseHeight2 === 0) {
    const xOffset = (argX / 90) ** 3 * half;
    const rad = argX * DEG_TO_RAD;
    const xA = -Math.cos(rad) * half - xOffset;
    const xB = Math.cos(rad) * half - xOffset;
    const yA = height - Math.sin(rad) * half + baseHeight1;
    const yB = height + Math.sin(rad) * half + baseHeight1;
    return [
      Math.hypot(xA + half, yA) - baseHeight1,
      Math.hypot(xB - half, yB) - baseHeight1,
    ];
  }
  if (baseHeight1 === 0 && baseHeight2 !== 0) {
    const angle = -argX;
    const xOffset = (angle / 90) ** 3 * half;
    const rad = angle * DEG_TO_RAD;
    const origin = baseHeight2 + maxHeight;
    const xA = -Math.cos(rad) * half - xOffset;
    const xB = Math.cos(rad) * half - xOffset;
    const yA = height - Math.sin(rad) * half;
    const yB = height + Math.sin(rad) * half;
    return [
      origin - Math.hypot(xA + half, yA - origin),
      origin - Math.hypot(xB - half, yB - origin),
    ];
  }
  return null;
};

/** sidian_forward_model：moveWhat 1 用 P、2 用 Y，其他只按 H */
export const fourPointForward = (
  height: number,
  pitch: number,
  yaw: number,
  baseHeight1: number,
  baseHeight2: number,
  lengthInside: number,
  widthInside: number,
  maxHeight: number,
  moveWhat: number,
): number[] | null => {
  const singleBase =
    (baseHeight1 !== 0 && baseHeight2 === 0) || (baseHeight1 === 0 && baseHeight2 !== 0);
  if (!singleBase) return null;
  if (moveWhat === 1) {
    const [a, b] = twoPointForward(height, pitch, baseHeight1, baseHeight2, lengthInside, maxHeight)!;
    return [a, b, b, a];
  }
  if (moveWhat === 2) {
    const [a, b] = twoPointForward(height, yaw, baseHeight1, baseHeight2, widthInside, maxHeight)!;
    return [b, b, a, a];
  }
  return [height, height, height, height];
};
