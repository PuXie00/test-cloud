import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { blockObjectIds, blockTimesMs } from "./timeline-snap";

/**
 * 跳关键帧用的时刻：序列起止 + 块的时刻（动态预设取起止）。
 * 给了物体且序列里有这些物体的块时只看它们；否则看整条序列。
 */
export const keyframeTimesMs = (
  sequence: ActionSequenceConfig,
  totalMs: number,
  objectIds: readonly number[] = [],
): number[] => {
  const focus = new Set(objectIds);
  const involves = (objectIdsOfBlock: number[]) => objectIdsOfBlock.some((id) => focus.has(id));
  const focused = focus.size > 0 && sequence.blocks.some((block) => involves(blockObjectIds(block)));
  const times = new Set<number>([0, totalMs]);
  for (const block of sequence.blocks) {
    if (focused && !involves(blockObjectIds(block))) continue;
    for (const ms of blockTimesMs(block)) times.add(ms);
  }
  return [...times].sort((left, right) => left - right);
};

export const previousKeyframeMs = (times: readonly number[], cursorMs: number): number | null => {
  for (let index = times.length - 1; index >= 0; index -= 1) {
    const ms = times[index]!;
    if (ms < cursorMs) return ms;
  }
  return null;
};

export const nextKeyframeMs = (times: readonly number[], cursorMs: number): number | null =>
  times.find((ms) => ms > cursorMs) ?? null;
