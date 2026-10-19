import type { ActionSequenceConfig, TimelineBlock } from "@/app/project/action-sequence/types";

/** 拖动时离吸附目标这么近（屏幕像素）就吸过去，和缩放无关 */
export const SNAP_THRESHOLD_PX = 8;
/** 整秒吸得弱一些，免得默认缩放下处处都吸到整秒 */
export const WHOLE_SECOND_SNAP_THRESHOLD_PX = 4;

/** 块占用的时刻：动态预设是起止两端，其余块是 atMs */
export const blockTimesMs = (block: TimelineBlock): number[] =>
  block.kind === "dynamic-preset" ? [block.startMs, block.endMs] : [block.atMs];

export const blockObjectIds = (block: TimelineBlock): number[] =>
  block.kind === "pose" || block.kind === "instruction" ? [block.objectId] : block.orderedObjectIds;

/**
 * 吸附目标：序列起止、指针、块的时刻。
 * excludeObjectIds 里物体的块不算（拖动时同一行的块不能叠在同一时刻）。
 */
export const snapTargetTimes = (input: {
  sequence: ActionSequenceConfig;
  totalMs: number;
  cursorMs?: number;
  excludeObjectIds?: ReadonlySet<number>;
}): number[] => {
  const targets = new Set<number>([0, input.totalMs]);
  if (input.cursorMs !== undefined) targets.add(input.cursorMs);
  for (const block of input.sequence.blocks) {
    if (blockObjectIds(block).some((objectId) => input.excludeObjectIds?.has(objectId))) continue;
    for (const ms of blockTimesMs(block)) targets.add(ms);
  }
  return [...targets].sort((left, right) => left - right);
};

export type SnapResult = {
  ms: number;
  /** 吸到的时刻；没吸时为 null */
  snappedTo: number | null;
};

/** 把拖到的时刻吸到最近的目标；目标和整秒都不够近时原样返回 */
export const snapToTargets = (ms: number, targets: readonly number[], pxPerSecond: number): SnapResult => {
  const msPerPx = 1000 / Math.max(pxPerSecond, 0.001);
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const consider = (target: number, thresholdPx: number) => {
    const distance = Math.abs(target - ms);
    if (distance > thresholdPx * msPerPx || distance >= bestDistance) return;
    best = target;
    bestDistance = distance;
  };
  for (const target of targets) consider(target, SNAP_THRESHOLD_PX);
  consider(Math.round(ms / 1000) * 1000, WHOLE_SECOND_SNAP_THRESHOLD_PX);
  return best === null ? { ms, snappedTo: null } : { ms: best, snappedTo: best };
};

/**
 * 整段（动态预设）拖动：起止两端谁离目标近就吸谁，返回吸附后的起点。
 */
export const snapSpanStart = (
  startMs: number,
  durationMs: number,
  targets: readonly number[],
  pxPerSecond: number,
): SnapResult => {
  const start = snapToTargets(startMs, targets, pxPerSecond);
  const end = snapToTargets(startMs + durationMs, targets, pxPerSecond);
  const startShift = start.snappedTo === null ? Number.POSITIVE_INFINITY : Math.abs(start.ms - startMs);
  const endShift =
    end.snappedTo === null ? Number.POSITIVE_INFINITY : Math.abs(end.ms - (startMs + durationMs));
  if (startShift === Number.POSITIVE_INFINITY && endShift === Number.POSITIVE_INFINITY) {
    return { ms: startMs, snappedTo: null };
  }
  return startShift <= endShift
    ? start
    : { ms: end.ms - durationMs, snappedTo: end.snappedTo };
};
