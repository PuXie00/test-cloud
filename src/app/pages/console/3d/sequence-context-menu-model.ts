import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import type { FormationEdge } from "@/app/viz3d/pose-handles/pose-formation";
import { poseBlocksAtCursor } from "../components/action-builder/pose-handle-targets";
import { snapTimeMs } from "../components/action-builder/timeline/timeline-data";

/** 这些物体的位姿里，游标前最近的时刻和游标后最近的时刻（没有为 null） */
export const adjacentPoseTimes = (
  sequence: Pick<ActionSequenceConfig, "blocks">,
  objectIds: readonly number[],
  cursorMs: number,
): { prev: number | null; next: number | null } => {
  const at = snapTimeMs(cursorMs);
  const ids = new Set(objectIds);
  let prev: number | null = null;
  let next: number | null = null;
  for (const block of sequence.blocks) {
    if (block.kind !== "pose" || !ids.has(block.objectId)) continue;
    if (block.atMs < at && (prev === null || block.atMs > prev)) prev = block.atMs;
    if (block.atMs > at && (next === null || block.atMs < next)) next = block.atMs;
  }
  return { prev, next };
};

/** 这一刻这些物体的位姿块 id */
export const poseBlockIdsAt = (
  sequence: Pick<ActionSequenceConfig, "blocks">,
  objectIds: readonly number[],
  atMs: number,
): string[] => poseBlocksAtCursor(sequence, objectIds, atMs).map((block) => block.id);

/** 菜单顶上写作用于谁：右键的那台（多选时带上台数），空白处是选中的几台 */
export const sequenceMenuTitle = (input: { contextName: string | null; selectedCount: number }): string => {
  const { contextName, selectedCount } = input;
  if (contextName) return selectedCount > 1 ? `${contextName} 等 ${selectedCount} 台` : contextName;
  return selectedCount > 0 ? `选中的 ${selectedCount} 台` : "没有选中物体";
};

/** 「看全……的动作」 */
export const focusMotionLabel = (selectedCount: number): string =>
  selectedCount === 0 ? "看全整条动作" : selectedCount === 1 ? "看全这台的动作" : `看全这 ${selectedCount} 台的动作`;

export const FORMATION_EDGES: ReadonlyArray<{ edge: FormationEdge; label: string }> = [
  { edge: "bottom", label: "底边" },
  { edge: "center", label: "中心" },
  { edge: "top", label: "顶边" },
];

/** 高低差的快捷倍数（以平均高度为中心） */
export const HEIGHT_SPREAD_PRESETS: ReadonlyArray<{ factor: number; label: string }> = [
  { factor: 0, label: "拉平到平均高度" },
  { factor: 0.5, label: "缩小一半" },
  { factor: 2, label: "放大一倍" },
  { factor: -1, label: "上下翻转" },
];

/** 高低差小于这个（米）就算一样高 */
export const FLAT_SPREAD_M = 0.0005;

export const formatFactor = (factor: number): string => {
  const text = Number(factor.toFixed(2)).toString();
  return `×${text.replace("-", "−")}`;
};
