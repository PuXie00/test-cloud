/** 工程长度单位为 mm；Babylon 世界单位为 m */

export const MM_PER_M = 1000;

export const mmToM = (mm: number): number => mm / MM_PER_M;
export const mToMm = (m: number): number => m * MM_PER_M;

export type Vec3Like = { x: number; y: number; z: number };
export type DimensionsLike = { w: number; h: number; d: number };
export type MountLike = { x: number; z: number };

export const mmVec3ToM = (v: Vec3Like): Vec3Like => ({
  x: mmToM(v.x),
  y: mmToM(v.y),
  z: mmToM(v.z),
});

export const mVec3ToMm = (v: Vec3Like): Vec3Like => ({
  x: mToMm(v.x),
  y: mToMm(v.y),
  z: mToMm(v.z),
});

export const mmDimensionsToM = (d: DimensionsLike): DimensionsLike => ({
  w: mmToM(d.w),
  h: mmToM(d.h),
  d: mmToM(d.d),
});

export const mmMountToM = (m: MountLike): MountLike => ({
  x: mmToM(m.x),
  z: mmToM(m.z),
});
