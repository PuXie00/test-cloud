import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { blockTimesMs } from "./timeline-snap";

/** 跳关键帧用的时刻：整条序列的起止 + 所有块的时刻（动态预设取起止），不看选中的物体 */
export const keyframeTimesMs = (sequence: ActionSequenceConfig, totalMs: number): number[] => {
  const times = new Set<number>([0, totalMs]);
  for (const block of sequence.blocks) {
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
