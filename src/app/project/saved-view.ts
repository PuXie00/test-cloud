import type { SavedView, ViewPreset } from "@/app/viz3d/types";
import { DEFAULT_FOCAL_LENGTH_MM } from "@/app/viz3d/cameras/focal-length";
import { DEFAULT_VIEW_DISTANCE } from "@/app/viz3d/cameras/ViewPresets";
import {
  DEFAULT_GRID_SIZE_M,
  isGridSizeM,
  normalizeGridSizeM,
} from "@/app/viz3d/helpers/grid-config";

export type { SavedView } from "@/app/viz3d/types";
export { DEFAULT_GRID_SIZE_M, GRID_SIZE_PRESETS, isGridSizeM, normalizeGridSizeM } from "@/app/viz3d/helpers/grid-config";

const VIEW_PRESETS: readonly ViewPreset[] = [
  "top",
  "front",
  "back",
  "side",
  "left",
  "persp",
  "iso",
];

/** 新建工程缺省：persp + 默认焦距与视距 + 默认网格 */
export const createDefaultSavedView = (): SavedView => ({
  target: [0, 0, 0],
  alpha: -Math.PI / 4,
  beta: Math.PI / 3,
  zoomRadius: DEFAULT_VIEW_DISTANCE,
  orthoHalfHeight: DEFAULT_VIEW_DISTANCE * 0.5,
  preset: "persp",
  focalLengthMm: DEFAULT_FOCAL_LENGTH_MM,
  gridSize: DEFAULT_GRID_SIZE_M,
});

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** 相机字段合法（可不含 / 可不合法 gridSize）；供 normalize 软补网格尺寸 */
const hasValidCameraSavedViewFields = (value: unknown): value is Omit<SavedView, "gridSize"> & {
  gridSize?: unknown;
} => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.target) || v.target.length !== 3) return false;
  if (!v.target.every(isFiniteNumber)) return false;
  if (!isFiniteNumber(v.alpha) || !isFiniteNumber(v.beta)) return false;
  if (!isFiniteNumber(v.zoomRadius) || v.zoomRadius <= 0) return false;
  if (!isFiniteNumber(v.orthoHalfHeight) || v.orthoHalfHeight <= 0) return false;
  if (typeof v.preset !== "string" || !VIEW_PRESETS.includes(v.preset as ViewPreset)) {
    return false;
  }
  if (!isFiniteNumber(v.focalLengthMm)) return false;
  return true;
};

export const isSavedView = (value: unknown): value is SavedView => {
  if (!hasValidCameraSavedViewFields(value)) return false;
  return isGridSizeM((value as { gridSize?: unknown }).gridSize);
};

export const normalizeSavedView = (value: unknown): SavedView => {
  if (!hasValidCameraSavedViewFields(value)) {
    return createDefaultSavedView();
  }
  const v = value as Omit<SavedView, "gridSize"> & { gridSize?: unknown };
  return {
    target: [v.target[0], v.target[1], v.target[2]],
    alpha: v.alpha,
    beta: v.beta,
    zoomRadius: v.zoomRadius,
    orthoHalfHeight: v.orthoHalfHeight,
    preset: v.preset,
    focalLengthMm: v.focalLengthMm,
    gridSize: normalizeGridSizeM(v.gridSize),
  };
};
