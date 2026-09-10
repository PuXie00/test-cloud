import type { Vec3 } from "../types";

export type AABB = { min: Vec3; max: Vec3 };

export type Normalization = {
  scale: number;
  offset: Vec3;
};

const DEFAULT_TARGET_SIZE = 2;

/**
 * Computes uniform scale and translation so a model's AABB max extent ≈ targetSize
 * and center ≈ origin after applying offset then scale.
 * Pure function — no THREE dependency.
 */
export const computeModelNormalization = (
  box: AABB,
  targetSize: number = DEFAULT_TARGET_SIZE
): Normalization => {
  const extentX = box.max.x - box.min.x;
  const extentY = box.max.y - box.min.y;
  const extentZ = box.max.z - box.min.z;
  const maxExtent = Math.max(extentX, extentY, extentZ);

  if (maxExtent <= 0) {
    return { scale: 1, offset: { x: 0, y: 0, z: 0 } };
  }

  const centerX = (box.min.x + box.max.x) / 2;
  const centerY = (box.min.y + box.max.y) / 2;
  const centerZ = (box.min.z + box.max.z) / 2;

  const scale = targetSize / maxExtent;
  const snapZero = (v: number): number => (Math.abs(v) < 1e-12 ? 0 : v);
  return {
    scale,
    offset: {
      x: snapZero(-centerX * scale),
      y: snapZero(-centerY * scale),
      z: snapZero(-centerZ * scale),
    },
  };
};
