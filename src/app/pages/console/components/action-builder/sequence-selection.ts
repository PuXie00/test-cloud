import type { ResolvedActionSequence, ResolvedMotionSegment } from "@/app/project/action-sequence/resolve-sequence";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig, TimelineBlock } from "@/app/project/action-sequence/types";

export type SequenceSelection =
  | { kind: "block"; blockId: string }
  | { kind: "segment"; objectId: number; fromRef: string; toRef: string }
  | { kind: "multi-block"; blockIds: string[] }
  | null;

export type SequenceSelectionLookup =
  | { kind: "block"; block: TimelineBlock }
  | { kind: "segment"; segment: ResolvedMotionSegment }
  | { kind: "multi-block"; blocks: TimelineBlock[] }
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

export const findResolvedSegment = (
  resolved: ResolvedActionSequence,
  objectId: number,
  fromRef: string,
  toRef: string,
): ResolvedMotionSegment | undefined =>
  resolved.segments.find(
    (segment) =>
      segment.objectId === objectId && segment.fromRef === fromRef && segment.toRef === toRef,
  );

export const selectionBlockIds = (selection: SequenceSelection): string[] => {
  if (selection === null) return [];
  if (selection.kind === "block") return [selection.blockId];
  if (selection.kind === "multi-block") return [...selection.blockIds];
  return [];
};

export const isBlockSelected = (selection: SequenceSelection, blockId: string): boolean => {
  if (selection === null) return false;
  if (selection.kind === "block") return selection.blockId === blockId;
  if (selection.kind === "multi-block") return selection.blockIds.includes(blockId);
  return false;
};

export const selectionFromBlockIds = (blockIds: readonly string[]): SequenceSelection => {
  const unique = [...new Set(blockIds)];
  if (unique.length === 0) return null;
  if (unique.length === 1) {
    const blockId = unique[0];
    return blockId === undefined ? null : { kind: "block", blockId };
  }
  return { kind: "multi-block", blockIds: unique };
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
  if (selection.kind === "multi-block") {
    const blocks = findAuthoredBlocks(sequence, selection.blockIds);
    if (blocks.length === 0) return null;
    return { kind: "multi-block", blocks };
  }
  try {
    const resolvedSequence = resolved ?? resolveActionSequence(sequence);
    const segment = findResolvedSegment(
      resolvedSequence,
      selection.objectId,
      selection.fromRef,
      selection.toRef,
    );
    if (segment === undefined) return null;
    return { kind: "segment", segment };
  } catch {
    return null;
  }
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
  if (selection.kind === "multi-block") {
    const blockIds = selection.blockIds.filter((blockId) => sequenceHasBlock(sequences, blockId));
    if (blockIds.length === 0) return null;
    if (blockIds.length === 1) {
      const blockId = blockIds[0];
      return blockId === undefined ? null : { kind: "block", blockId };
    }
    return { kind: "multi-block", blockIds };
  }
  for (const sequence of sequences) {
    try {
      const resolved = resolveActionSequence(sequence);
      if (findResolvedSegment(resolved, selection.objectId, selection.fromRef, selection.toRef)) {
        return selection;
      }
    } catch {
      continue;
    }
  }
  return null;
};
