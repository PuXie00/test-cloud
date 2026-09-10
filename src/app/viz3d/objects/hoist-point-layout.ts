import type { AxisMount } from "@/app/project/hoist-point-defaults";
import type { Vec3 } from "../types";

/** 吊点 3D 几何缩放：相对物体尺寸，带下限保证小物体仍可见 */
export const computeHoistPointScale = (dimensions: {
  w: number;
  h: number;
  d: number;
}): number => {
  const base = Math.min(dimensions.w, dimensions.d, dimensions.h);
  return Math.max(0.18, base * 0.14);
};

/** 吊点始终贴物体顶面（局部 Y = h/2） */
export const resolveHoistPointLocalPosition = (
  dimensions: { h: number },
  mount: AxisMount,
): Vec3 => ({
  x: mount.x,
  y: dimensions.h / 2,
  z: mount.z,
});
