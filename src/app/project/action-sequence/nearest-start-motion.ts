import { solveMultiPointForward, type Vec3 } from "@/app/kinematics/multi-point-forward";

/** 对齐 python/就近位置计算.py 第二步：零速起止点到点运动、k/k² 缩放、电机速度上界。 */

export type AxisVad = { velocity: number; acceleration: number; deceleration: number };

export const ZERO_VAD: AxisVad = { velocity: 0, acceleration: 0, deceleration: 0 };

const DEG_TO_RAD = Math.PI / 180;
const DISTANCE_EPSILON = 1e-12;

export type MotionProfileResult = { peak: number; time: number };

export const minimumMotionProfile = (
  distance: number,
  velocity: number,
  acceleration: number,
  deceleration: number,
): MotionProfileResult => {
  const travel = Math.abs(distance);
  if (![travel, velocity, acceleration, deceleration].every(Number.isFinite)) {
    throw new Error("位移和速度、加速度、减速度必须是有限数值");
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

export type NearestStartGeometry =
  | { type: 1 }
  | { type: 2; baseHeight1: number; baseHeight2: number; lengthInside: number; maxHeight: number }
  | {
      type: 4;
      baseHeight1: number;
      baseHeight2: number;
      lengthInside: number;
      widthInside: number;
      maxHeight: number;
    }
  | {
      type: 8;
      baseHeight1: number;
      baseHeight2: number;
      maxHeight: number;
      betaInit: number;
      pointInitPos: readonly Vec3[];
    };

const twoPointForward = (
  height: number,
  argX: number,
  baseHeight1: number,
  baseHeight2: number,
  lengthInside: number,
  maxHeight: number,
): [number, number] => {
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
  throw new Error("两点模型必须恰有一个正基准高度");
};

const fourPointForward = (
  pose: HpyPose,
  geometry: Extract<NearestStartGeometry, { type: 4 }>,
  moveWhat: 0 | 1 | 2,
): number[] => {
  if (moveWhat === 0) return [pose.h, pose.h, pose.h, pose.h];
  const span = moveWhat === 1 ? geometry.lengthInside : geometry.widthInside;
  const angle = moveWhat === 1 ? pose.p : pose.y;
  const [left, right] = twoPointForward(
    pose.h,
    angle,
    geometry.baseHeight1,
    geometry.baseHeight2,
    span,
    geometry.maxHeight,
  );
  return moveWhat === 1 ? [left, right, right, left] : [right, right, left, left];
};

const assertFiniteLengths = (lengths: readonly number[], objectId: number): void => {
  if (lengths.length === 0 || !lengths.every(Number.isFinite)) {
    throw new Error(`模型${objectId}端点正解未返回有效电机位置`);
  }
};

const assertSingleBaseHeight = (
  objectId: number,
  baseHeight1: number,
  baseHeight2: number,
  maxHeight: number,
): void => {
  const single = (baseHeight1 > 0 && baseHeight2 === 0) || (baseHeight1 === 0 && baseHeight2 > 0);
  if (!single || !(maxHeight > 0)) {
    throw new Error(`模型${objectId}必须恰有一个正基准高度，且最大行程大于0`);
  }
};

const multiPointBound = (
  objectId: number,
  geometry: Extract<NearestStartGeometry, { type: 8 }>,
  current: HpyPose,
  target: HpyPose,
  velocity: HpyPose,
): number => {
  const points = geometry.pointInitPos;
  if (points.length < 3 || !points.every((point) => point.every(Number.isFinite))) {
    throw new Error(`多点模型${objectId}需要至少三个有限XYZ吊点`);
  }
  const radius = Math.max(...points.map((point) => Math.hypot(point[0], point[1])));
  const uniqueXy = new Set(points.map((point) => `${point[0]},${point[1]}`));
  if (radius <= 1e-12 || uniqueXy.size !== points.length) {
    throw new Error(`多点模型${objectId}吊点平面退化或重复`);
  }
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const p = points[index]!;
    const q = points[(index + 1) % points.length]!;
    area += p[0] * q[1] - p[1] * q[0];
  }
  const orientation = area > 0 ? 1 : -1;
  let minRadius = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const p = points[index]!;
    const q = points[(index + 1) % points.length]!;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const edge = Math.hypot(dx, dy);
    const originDistance = (orientation * (p[0] * q[1] - p[1] * q[0])) / edge;
    const concave = points.some(
      (r) => orientation * (dx * (r[1] - p[1]) - dy * (r[0] - p[0])) < -radius * edge * 1e-10,
    );
    if (originDistance <= radius * 1e-10 || concave) {
      throw new Error(`多点模型${objectId}吊点必须组成包含原点的有序凸多边形`);
    }
    minRadius = Math.min(minRadius, originDistance);
  }
  const { baseHeight1, baseHeight2, maxHeight } = geometry;
  const effectiveHeights = [current, target].map((pose) =>
    baseHeight1 > 0 ? pose.h + baseHeight1 : baseHeight2 + maxHeight - pose.h,
  );
  if (Math.min(...effectiveHeights) < 0) {
    throw new Error(`多点模型${objectId}过渡的有效高度不能为负`);
  }
  const nMin = Math.min(100, 1.73 + (0.52 * Math.min(...effectiveHeights)) / radius);
  const nMax = Math.min(100, 1.73 + (0.52 * Math.max(...effectiveHeights)) / minRadius);
  const cH = 0.52 / (Math.E * nMin);
  const cP = (radius * nMax * DEG_TO_RAD) / 1.5707963;
  const cR = 1 + (nMax - 1.73) / (Math.E * nMin);
  const bound =
    (1 + cH) * velocity.h +
    (radius * DEG_TO_RAD + cP) * velocity.p +
    (3 * radius + (cR * radius * radius) / minRadius) * DEG_TO_RAD * velocity.y;
  for (const pose of [current, target]) {
    assertFiniteLengths(
      solveMultiPointForward({
        height: pose.h,
        pitch: pose.p,
        roll: pose.y,
        pointInitPos: points,
        baseHeight1,
        baseHeight2,
        maxHeight,
        betaInit: geometry.betaInit,
      }),
      objectId,
    );
  }
  return bound;
};

/** 过渡路径上实际电机速度的保守上界（与 Python calculate_non_forced_motion 第三步一致）。 */
export const motorVelocityUpperBound = (
  objectId: number,
  geometry: NearestStartGeometry,
  current: HpyPose,
  target: HpyPose,
  velocity: HpyPose,
): number => {
  if (geometry.type === 1) {
    if (velocity.p > 0 || velocity.y > 0) throw new Error(`单点模型${objectId}只支持H轴位移`);
    return velocity.h;
  }
  if (geometry.type === 8) return multiPointBound(objectId, geometry, current, target, velocity);

  assertSingleBaseHeight(objectId, geometry.baseHeight1, geometry.baseHeight2, geometry.maxHeight);
  const length = geometry.lengthInside;
  const width = geometry.type === 4 ? geometry.widthInside : length;
  if (Math.min(length, width) <= 0) throw new Error(`模型${objectId}吊点间距必须大于0`);

  let tiltAxis: "p" | "y" = "p";
  if (geometry.type === 2) {
    if (velocity.y > 0) throw new Error(`两点模型${objectId}不支持Y轴位移`);
    for (const pose of [current, target]) {
      assertFiniteLengths(
        twoPointForward(pose.h, pose.p, geometry.baseHeight1, geometry.baseHeight2, length, geometry.maxHeight),
        objectId,
      );
    }
  } else {
    const pTilt = [current, target].some((pose) => Math.abs(pose.p) > 1e-10);
    const yTilt = [current, target].some((pose) => Math.abs(pose.y) > 1e-10);
    if (pTilt && yTilt) throw new Error(`四点模型${objectId}当前正解不支持P/Y混合倾斜过渡`);
    const moveWhat = pTilt ? 1 : yTilt ? 2 : 0;
    tiltAxis = yTilt ? "y" : "p";
    for (const pose of [current, target]) {
      assertFiniteLengths(fourPointForward(pose, geometry, moveWhat), objectId);
    }
  }
  const halfSpan = (tiltAxis === "p" ? length : width) / 2;
  const angle = Math.max(Math.abs(current[tiltAxis]), Math.abs(target[tiltAxis]));
  const angularSpeed = velocity[tiltAxis];
  return velocity.h + (halfSpan * DEG_TO_RAD + (3 * halfSpan * angle * angle) / 90 ** 3) * angularSpeed;
};
