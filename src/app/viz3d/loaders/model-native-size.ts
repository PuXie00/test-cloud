import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { getNodeMetadata, setNodeMetadata } from "../babylon/utils";

/** Axis-aligned size in meters (Babylon world units). */
export type ModelNativeSizeM = { w: number; h: number; d: number };

export type ModelNativeSizeMm = { width: number; height: number; depth: number };

export const MODEL_NATIVE_SIZE_M_KEY = "viz3dNativeSizeM";

const MIN_EXTENT_M = 1e-6;

/** File units > 50 on max axis are treated as mm (common CAD export). */
export const normalizeFileExtentsToMeters = (extents: ModelNativeSizeM): ModelNativeSizeM => {
  const max = Math.max(extents.w, extents.h, extents.d);
  if (max > 50) {
    return { w: extents.w / 1000, h: extents.h / 1000, d: extents.d / 1000 };
  }
  return extents;
};

export const setTemplateNativeSizeM = (template: TransformNode, size: ModelNativeSizeM): void => {
  setNodeMetadata(template, MODEL_NATIVE_SIZE_M_KEY, size);
};

export const getTemplateNativeSizeM = (template: TransformNode): ModelNativeSizeM | undefined => {
  const raw = getNodeMetadata(template, MODEL_NATIVE_SIZE_M_KEY);
  if (!raw || typeof raw !== "object") return undefined;
  const { w, h, d } = raw as ModelNativeSizeM;
  if (![w, h, d].every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)) {
    return undefined;
  }
  return { w, h, d };
};

export const nativeSizeMToMm = (size: ModelNativeSizeM): ModelNativeSizeMm => ({
  width: Math.round(size.w * 1000),
  height: Math.round(size.h * 1000),
  depth: Math.round(size.d * 1000),
});

/** Uniform scale so visual width matches target width (meters). */
export const uniformScaleForWidth = (native: ModelNativeSizeM, widthM: number): number => {
  const base = Math.max(native.w, MIN_EXTENT_M);
  return widthM / base;
};

/** Keep height/depth proportional when width changes (mm). */
export const scaleExternalDimensionsByWidth = (
  current: ModelNativeSizeMm,
  nextWidthMm: number,
): ModelNativeSizeMm => {
  const prevW = Math.max(current.width, MIN_EXTENT_M);
  const ratio = nextWidthMm / prevW;
  return {
    width: nextWidthMm,
    height: current.height * ratio,
    depth: current.depth * ratio,
  };
};
