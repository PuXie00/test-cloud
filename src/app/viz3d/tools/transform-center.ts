import type { Vec3 } from "../types";

export type TransformCenterPreset = "geometry" | "top" | "bottom" | "reset";

export const resolveTransformCenterOffset = (
  preset: TransformCenterPreset,
  dimensions: { w: number; h: number; d: number },
): Vec3 => {
  if (preset === "top") {
    return { x: 0, y: dimensions.h / 2, z: 0 };
  }
  if (preset === "bottom") {
    return { x: 0, y: -dimensions.h / 2, z: 0 };
  }
  return { x: 0, y: 0, z: 0 };
};
