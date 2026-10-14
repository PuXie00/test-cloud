import type { VirtualAxisId } from "@/app/project/project-document-types";
import { VIRTUAL_AXIS_IDS } from "./timeline/timeline-data";

/**
 * 虚轴编辑的共用规则：动作页「多选位姿」和手动控制页「维度控制」用同一套标签、
 * 步进和范围规则，两边的批量编辑保持一致。
 */

export type AxisEditMode = "abs" | "rel";

export const AXIS_MODE_TABS = [
  { id: "abs", label: "绝对" },
  { id: "rel", label: "相对" },
] as const;

/** 虚轴 1 步进 1，虚轴 2、3 步进 0.1 */
export const virtualAxisStep = (axis: VirtualAxisId): number => (axis === "v1" ? 1 : 0.1);

export const virtualAxisLabel = (axis: VirtualAxisId): string =>
  `虚轴${VIRTUAL_AXIS_IDS.indexOf(axis) + 1}`;

/** 多个物体的行程交集；没有交集或没有行程时不设上下限（写入时仍按各物体自己的行程截断） */
export const intersectAxisRange = (
  ranges: readonly { min: number; max: number }[],
): { min?: number; max?: number } => {
  if (ranges.length === 0) return {};
  const min = Math.max(...ranges.map((range) => range.min));
  const max = Math.min(...ranges.map((range) => range.max));
  if (min > max) return {};
  return { min, max };
};
