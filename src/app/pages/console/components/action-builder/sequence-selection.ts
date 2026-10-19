import type { ResolvedActionSequence, ResolvedMotionSegment } from "@/app/project/action-sequence/resolve-sequence";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig, TimelineBlock } from "@/app/project/action-sequence/types";

/** 从运动区间点选进来：属性面板先显示运动区间 */
export type SelectionFocus = "segments";

/**
 * 时间轴选中的块。运动区间没有单独的选中：两端的块都选中就是选中了这个区间，
 * 点区间等于选中它两端的块。
 */
export type SequenceSelection =
  | { kind: "block"; blockId: string }
  | { kind: "multi-block"; blockIds: string[]; focus?: SelectionFocus }
  | null;

export type SequenceSelectionLookup =
  | { kind: "block"; block: TimelineBlock }
  | {
      kind: "multi-block";
      blocks: TimelineBlock[];
      /** 两端都选中的运动区间 */
      segments: ResolvedMotionSegment[];
      focus?: SelectionFocus;
    }
  | null;

export const findAuthoredBlock = (
  sequence: ActionSequenceConfig,
  blockId: string,
): TimelineBlock | undefined => sequence.blocks.find((block) => block.id === blockId);

export const findAuthoredBlocks = (
  sequence: ActionSequenceConfig,
  blockIds: readonly string[],
): TimelineBlock[] =>
  blockIds.flatMap((blockId) => {
    const block = findAuthoredBlock(sequence, blockId);
    return block === undefined ? [] : [block];
  });

export const selectionBlockIds = (selection: SequenceSelection): string[] => {
  if (selection === null) return [];
  if (selection.kind === "block") return [selection.blockId];
  return [...selection.blockIds];
};

export const isBlockSelected = (selection: SequenceSelection, blockId: string): boolean => {
  if (selection === null) return false;
  if (selection.kind === "block") return selection.blockId === blockId;
  return selection.blockIds.includes(blockId);
};

export const selectionFromBlockIds = (
  blockIds: readonly string[],
  focus?: SelectionFocus,
): SequenceSelection => {
  const unique = [...new Set(blockIds)];
  if (unique.length === 0) return null;
  if (unique.length === 1) {
    const blockId = unique[0];
    return blockId === undefined ? null : { kind: "block", blockId };
  }
  return focus ? { kind: "multi-block", blockIds: unique, focus } : { kind: "multi-block", blockIds: unique };
};

/** 运动区间两端所在的块：位姿块，或生成这个关键点的预设块 */
export const segmentEndpointBlockIds = (
  resolved: Pick<ResolvedActionSequence, "poses">,
  segment: Pick<ResolvedMotionSegment, "fromRef" | "toRef">,
): string[] => {
  const blockOf = (ref: string) =>
    resolved.poses.find((point) => point.sourceRef === ref)?.sourceBlockId ?? null;
  const from = blockOf(segment.fromRef);
  const to = blockOf(segment.toRef);
  if (from === null || to === null) return [];
  return from === to ? [from] : [from, to];
};

/** 两端的块都选中了的可配置运动区间 */
export const selectedSegmentsOf = (
  resolved: Pick<ResolvedActionSequence, "poses" | "segments">,
  blockIds: readonly string[],
): ResolvedMotionSegment[] => {
  if (blockIds.length < 2) return [];
  const selected = new Set(blockIds);
  const blockByRef = new Map(resolved.poses.map((point) => [point.sourceRef, point.sourceBlockId]));
  return resolved.segments.filter((segment) => {
    if (!segment.configurable) return false;
    const from = blockByRef.get(segment.fromRef);
    const to = blockByRef.get(segment.toRef);
    return from != null && to != null && selected.has(from) && selected.has(to);
  });
};

/** 单击运动区间：只选中它两端的块 */
export const segmentSelection = (
  resolved: Pick<ResolvedActionSequence, "poses">,
  segment: Pick<ResolvedMotionSegment, "fromRef" | "toRef">,
): SequenceSelection => selectionFromBlockIds(segmentEndpointBlockIds(resolved, segment), "segments");

/** Ctrl/⌘ 单击块：在选中里加上或去掉它 */
export const toggleBlockSelection = (
  selection: SequenceSelection,
  blockId: string,
): SequenceSelection => {
  const ids = selectionBlockIds(selection);
  return selectionFromBlockIds(
    ids.includes(blockId) ? ids.filter((id) => id !== blockId) : [...ids, blockId],
  );
};

/**
 * Ctrl/⌘ 单击运动区间：没选中就加上两端；选中了就去掉两端，
 * 但别的选中区间还要用的端点留着（两端都被别的区间用着时只能一起去掉）。
 */
export const toggleSegmentSelection = (
  resolved: Pick<ResolvedActionSequence, "poses" | "segments">,
  selection: SequenceSelection,
  segment: Pick<ResolvedMotionSegment, "key" | "fromRef" | "toRef">,
): SequenceSelection => {
  const ids = selectionBlockIds(selection);
  const endpoints = segmentEndpointBlockIds(resolved, segment);
  if (endpoints.length === 0) return selection;
  if (!endpoints.every((id) => ids.includes(id))) {
    return selectionFromBlockIds([...ids, ...endpoints], "segments");
  }
  const stillNeeded = new Set(
    selectedSegmentsOf(resolved, ids)
      .filter((other) => other.key !== segment.key)
      .flatMap((other) => segmentEndpointBlockIds(resolved, other)),
  );
  const releasable = endpoints.filter((id) => !stillNeeded.has(id));
  const removed = new Set(releasable.length > 0 ? releasable : endpoints);
  return selectionFromBlockIds(ids.filter((id) => !removed.has(id)), "segments");
};

export const lookupSequenceSelection = (
  sequence: ActionSequenceConfig,
  selection: SequenceSelection,
  resolved?: ResolvedActionSequence,
): SequenceSelectionLookup => {
  if (selection === null) return null;
  if (selection.kind === "block") {
    const block = findAuthoredBlock(sequence, selection.blockId);
    if (block === undefined) return null;
    return { kind: "block", block };
  }
  const blocks = findAuthoredBlocks(sequence, selection.blockIds);
  if (blocks.length === 0) return null;
  let segments: ResolvedMotionSegment[] = [];
  try {
    segments = selectedSegmentsOf(
      resolved ?? resolveActionSequence(sequence),
      blocks.map((block) => block.id),
    );
  } catch {
    segments = [];
  }
  return selection.focus
    ? { kind: "multi-block", blocks, segments, focus: selection.focus }
    : { kind: "multi-block", blocks, segments };
};

const sequenceHasBlock = (sequences: ActionSequenceConfig[], blockId: string): boolean =>
  sequences.some((sequence) => sequence.blocks.some((block) => block.id === blockId));

export const pruneSequenceSelection = (
  sequences: ActionSequenceConfig[],
  selection: SequenceSelection,
): SequenceSelection => {
  if (selection === null) return null;
  if (selection.kind === "block") {
    return sequenceHasBlock(sequences, selection.blockId) ? selection : null;
  }
  const blockIds = selection.blockIds.filter((blockId) => sequenceHasBlock(sequences, blockId));
  if (blockIds.length === selection.blockIds.length) return selection;
  return selectionFromBlockIds(blockIds, selection.focus);
};
