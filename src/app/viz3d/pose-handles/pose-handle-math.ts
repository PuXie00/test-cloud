import type { Vec3 } from "../types";

/** 屏幕（画布）坐标，CSS px，左上为原点 */
export type Pt = { x: number; y: number };

/** direction 为单位向量 */
export type Ray = { origin: Vec3; direction: Vec3 };

export const ZERO_VEC: Vec3 = { x: 0, y: 0, z: 0 };
export const UP_VEC: Vec3 = { x: 0, y: 1, z: 0 };

export const addVec = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const subVec = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scaleVec = (v: Vec3, factor: number): Vec3 => ({ x: v.x * factor, y: v.y * factor, z: v.z * factor });
export const dotVec = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const crossVec = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const lengthVec = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
export const distanceVec = (a: Vec3, b: Vec3): number => lengthVec(subVec(a, b));

/** 长度太小时返回 null */
export const normalizeVec = (v: Vec3, epsilon = 1e-12): Vec3 | null => {
  const length = lengthVec(v);
  return length > epsilon ? scaleVec(v, 1 / length) : null;
};

/** 去掉沿 axis（单位向量）的分量 */
export const rejectVec = (v: Vec3, axis: Vec3): Vec3 => subVec(v, scaleVec(axis, dotVec(v, axis)));

/** 绕单位轴 axis 转 angle（弧度，右手定则） */
export const rotateVec = (v: Vec3, axis: Vec3, angle: number): Vec3 => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return addVec(
    addVec(scaleVec(v, cos), scaleVec(crossVec(axis, v), sin)),
    scaleVec(axis, dotVec(axis, v) * (1 - cos)),
  );
};

/** 两个单位向量之间的夹角（弧度） */
export const angleBetween = (a: Vec3, b: Vec3): number =>
  Math.atan2(lengthVec(crossVec(a, b)), dotVec(a, b));

/** 和 axis 垂直的任意单位向量 */
export const anyPerpendicular = (axis: Vec3): Vec3 => {
  const helper = Math.abs(axis.y) < 0.9 ? UP_VEC : { x: 1, y: 0, z: 0 };
  return normalizeVec(crossVec(helper, axis)) ?? { x: 1, y: 0, z: 0 };
};

/** 角度收进 (−π, π] */
export const wrapAngle = (rad: number): number => {
  const wrapped = (rad + Math.PI) % (2 * Math.PI);
  return (wrapped <= 0 ? wrapped + 2 * Math.PI : wrapped) - Math.PI;
};

/** 角度（度）收进 (−180, 180] */
export const wrapDegrees = (deg: number): number => (wrapAngle((deg * Math.PI) / 180) * 180) / Math.PI;

export const pointOnRay = (ray: Ray, t: number): Vec3 => addVec(ray.origin, scaleVec(ray.direction, t));

/** 射线上离 point 最近的参数（可为负） */
export const closestRayParam = (ray: Ray, point: Vec3): number =>
  dotVec(subVec(point, ray.origin), ray.direction);

/**
 * 直线（过 point、单位方向 dir）上离射线最近的点：返回沿 dir 的参数（米）。
 * 视线和直线几乎平行时 null。
 */
export const closestLineParamToRay = (ray: Ray, point: Vec3, dir: Vec3): number | null => {
  const w0 = subVec(point, ray.origin);
  const b = dotVec(dir, ray.direction);
  const denominator = 1 - b * b;
  if (denominator < 1e-6) return null;
  const d = dotVec(dir, w0);
  const e = dotVec(ray.direction, w0);
  return (b * e - d) / denominator;
};

/** 射线与平面（过 point、法线 normal）的交点；平行或交点在射线背后时 null */
export const intersectRayPlane = (ray: Ray, point: Vec3, normal: Vec3): Vec3 | null => {
  const denominator = dotVec(ray.direction, normal);
  if (Math.abs(denominator) < 1e-9) return null;
  const t = dotVec(subVec(point, ray.origin), normal) / denominator;
  return t < 0 ? null : pointOnRay(ray, t);
};

/** 射线与球的两个交点（近、远）；不相交时 null */
export const intersectRaySphere = (ray: Ray, center: Vec3, radius: number): [Vec3, Vec3] | null => {
  const toCenter = subVec(center, ray.origin);
  const along = dotVec(toCenter, ray.direction);
  const distanceSq = dotVec(toCenter, toCenter) - along * along;
  const radiusSq = radius * radius;
  if (distanceSq > radiusSq) return null;
  const half = Math.sqrt(radiusSq - distanceSq);
  return [pointOnRay(ray, along - half), pointOnRay(ray, along + half)];
};

export const distancePt = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 点到线段的距离（屏幕） */
export const distanceToSegment = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-12) return distancePt(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** 点到折线的距离；少于两点时为无穷大 */
export const distanceToPolyline = (p: Pt, points: readonly Pt[]): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    best = Math.min(best, distanceToSegment(p, points[index - 1]!, points[index]!));
  }
  return best;
};
