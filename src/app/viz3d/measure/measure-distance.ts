import type { Vec3 } from "../types";

export type AABB = { min: Vec3; max: Vec3 };

export type DistanceResult = {
  distance: number;
  pointA: Vec3;
  pointB: Vec3;
};

const closestPointOnAabb = (box: AABB, point: Vec3): Vec3 => ({
  x: Math.min(Math.max(point.x, box.min.x), box.max.x),
  y: Math.min(Math.max(point.y, box.min.y), box.max.y),
  z: Math.min(Math.max(point.z, box.min.z), box.max.z),
});

export const minDistanceBetweenAabbs = (a: AABB, b: AABB): DistanceResult => {
  const centerA: Vec3 = {
    x: (a.min.x + a.max.x) / 2,
    y: (a.min.y + a.max.y) / 2,
    z: (a.min.z + a.max.z) / 2,
  };

  let pointB = closestPointOnAabb(b, centerA);
  let pointA = closestPointOnAabb(a, pointB);
  pointB = closestPointOnAabb(b, pointA);

  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  const dz = pointB.z - pointA.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return { distance, pointA, pointB };
};

export const groundDistanceFromAabb = (
  box: AABB
): { distance: number; groundPoint: Vec3 } => {
  const distance = Math.max(0, box.min.y);
  const groundPoint: Vec3 = {
    x: (box.min.x + box.max.x) / 2,
    y: 0,
    z: (box.min.z + box.max.z) / 2,
  };
  return { distance, groundPoint };
};
