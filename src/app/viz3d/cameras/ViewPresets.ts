import type { Vec3, ViewPreset } from "../types";

export type ViewPose = { position: Vec3; target: Vec3; up: Vec3 };

export const DEFAULT_VIEW_DISTANCE = 14;

/** 顶/前/后/侧/左为正交视角；透视与等轴测保持透视 */
export const isOrthographicViewPreset = (preset: ViewPreset): boolean =>
  preset === "top" ||
  preset === "front" ||
  preset === "back" ||
  preset === "side" ||
  preset === "left";

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

const DIRECTIONS: Record<ViewPreset, Vec3> = {
  top: { x: 0, y: 1, z: 0 },
  front: { x: 0, y: 0, z: 1 },
  back: { x: 0, y: 0, z: -1 },
  side: { x: 1, y: 0, z: 0 },
  left: { x: -1, y: 0, z: 0 },
  persp: { x: 1, y: 1, z: 1 },
  iso: { x: 1, y: 0.6, z: 1 },
};

const UP_VECTORS: Record<ViewPreset, Vec3> = {
  top: { x: 0, y: 0, z: -1 },
  front: { x: 0, y: 1, z: 0 },
  back: { x: 0, y: 1, z: 0 },
  side: { x: 0, y: 1, z: 0 },
  left: { x: 0, y: 1, z: 0 },
  persp: { x: 0, y: 1, z: 0 },
  iso: { x: 0, y: 1, z: 0 },
};

const length = (vec: Vec3): number => Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z);

export const resolveViewPose = (
  preset: ViewPreset,
  distance: number = DEFAULT_VIEW_DISTANCE
): ViewPose => {
  const dir = DIRECTIONS[preset];
  const len = length(dir) || 1;
  return {
    position: {
      x: (dir.x / len) * distance,
      y: (dir.y / len) * distance,
      z: (dir.z / len) * distance,
    },
    target: { ...ORIGIN },
    up: { ...UP_VECTORS[preset] },
  };
};
