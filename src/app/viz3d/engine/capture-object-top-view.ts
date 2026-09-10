import { mToMm } from "@/app/project/length-units";

export type ObjectTopViewBoundsMm = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type ObjectTopViewCapture = {
  /** PNG data URL */
  pngBase64: string;
  /** Local XZ footprint used for ortho framing (mm), object space */
  boundsMm: ObjectTopViewBoundsMm;
  widthPx: number;
  heightPx: number;
};

export type CaptureObjectTopViewOptions = {
  /** Longest edge in pixels; default 1024 */
  maxEdgePx?: number;
};

export const DEFAULT_TOP_VIEW_MAX_EDGE_PX = 1024;

/** Local XZ AABB from object dimensions in meters (engine config units). */
export const resolveTopViewBoundsMm = (dimensionsM: {
  w: number;
  d: number;
}): ObjectTopViewBoundsMm | null => {
  if (!(dimensionsM.w > 0) || !(dimensionsM.d > 0)) return null;
  const halfW = mToMm(dimensionsM.w) / 2;
  const halfD = mToMm(dimensionsM.d) / 2;
  return {
    minX: -halfW,
    maxX: halfW,
    minZ: -halfD,
    maxZ: halfD,
  };
};

export const resolveTopViewPixelSize = (
  dimensionsM: { w: number; d: number },
  maxEdgePx = DEFAULT_TOP_VIEW_MAX_EDGE_PX,
): { widthPx: number; heightPx: number } | null => {
  if (!(dimensionsM.w > 0) || !(dimensionsM.d > 0) || !(maxEdgePx > 0)) return null;
  const aspect = dimensionsM.w / dimensionsM.d;
  if (aspect >= 1) {
    return {
      widthPx: Math.max(1, Math.round(maxEdgePx)),
      heightPx: Math.max(1, Math.round(maxEdgePx / aspect)),
    };
  }
  return {
    widthPx: Math.max(1, Math.round(maxEdgePx * aspect)),
    heightPx: Math.max(1, Math.round(maxEdgePx)),
  };
};
