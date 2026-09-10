import type { ActionSequenceConfig, TimelineBlock } from "@/app/project/action-sequence/types";
import { pxToMs } from "./timeline-data";
import { POINT_BLOCK_HIT_MIN_PX } from "./timeline-view-extent";

export type MarqueeRange = {
  startMs: number;
  endMs: number;
  startRow: number;
  endRow: number;
};

const uniqueIds = (ids: number[]): number[] => [...new Set(ids)];

const rangesOverlap = (a0: number, a1: number, b0: number, b1: number): boolean =>
  Math.max(a0, b0) <= Math.min(a1, b1);

const blockRowIndices = (block: TimelineBlock, objectIdsInRowOrder: readonly number[]): number[] => {
  const objectIds = "objectId" in block ? [block.objectId] : uniqueIds(block.orderedObjectIds);
  return objectIds
    .map((objectId) => objectIdsInRowOrder.indexOf(objectId))
    .filter((index) => index >= 0);
};

const blockTimeRange = (
  block: TimelineBlock,
  pxPerSecond: number,
): { startMs: number; endMs: number } => {
  if (block.kind === "dynamic-preset") {
    return { startMs: block.startMs, endMs: block.endMs };
  }
  const padMs = pxToMs(POINT_BLOCK_HIT_MIN_PX / 2, pxPerSecond);
  const atMs = block.atMs;
  return { startMs: atMs - padMs, endMs: atMs + padMs };
};

export const collectMarqueeBlockIds = (
  sequence: ActionSequenceConfig,
  objectIdsInRowOrder: readonly number[],
  marquee: MarqueeRange,
  pxPerSecond: number,
): string[] => {
  const rowStart = Math.min(marquee.startRow, marquee.endRow);
  const rowEnd = Math.max(marquee.startRow, marquee.endRow);
  const timeStart = Math.min(marquee.startMs, marquee.endMs);
  const timeEnd = Math.max(marquee.startMs, marquee.endMs);
  const hits: string[] = [];
  for (const block of sequence.blocks) {
    const rows = blockRowIndices(block, objectIdsInRowOrder);
    if (rows.length === 0) continue;
    if (!rows.some((row) => rangesOverlap(row, row, rowStart, rowEnd))) continue;
    const range = blockTimeRange(block, pxPerSecond);
    if (!rangesOverlap(range.startMs, range.endMs, timeStart, timeEnd)) continue;
    hits.push(block.id);
  }
  return hits;
};
