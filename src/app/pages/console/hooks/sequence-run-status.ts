import type { ChapterItem } from "../components/program-panel/program-data";

export const formatExecTime = (ms: number): string => {
  const totalSeconds = ms / 1000;
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
};

export const nextChapterSequence = (
  items: readonly ChapterItem[],
  sequenceId: number,
): ChapterItem | null => {
  const index = items.findIndex((entry) => entry.sequence.id === sequenceId);
  if (index < 0) return null;
  return items.slice(index + 1).find((entry) => entry.kind === "sequence") ?? null;
};

export const hasNextChapterSequence = (
  items: readonly ChapterItem[],
  sequenceId: number,
): boolean => nextChapterSequence(items, sequenceId) !== null;

/** 下一条序列在当前页所挂的推子槽；不在当前页的推子槽里时为 null。 */
export const nextSequenceSlot = <Slot extends { sequence: { id: number } | null }>(
  items: readonly ChapterItem[],
  sequenceId: number | undefined,
  slots: readonly Slot[],
): Slot | null => {
  if (sequenceId === undefined) return null;
  const next = nextChapterSequence(items, sequenceId);
  if (!next) return null;
  return slots.find((slot) => slot.sequence?.id === next.sequence.id) ?? null;
};

/**
 * 任务卡继续 / 反向回所用的推子槽：优先卡片来源的槽；翻页后来源槽换了序列，就在当前页按序列找。
 * 序列不在当前页的推子槽里时为 null。
 */
export const execCardSlot = <Slot extends { index: number; sequence: { id: number } | null }>(
  card: { source: { kind: string; slotIndex?: number }; sequenceId?: number },
  slots: readonly Slot[],
): Slot | null => {
  const sequenceId = card.sequenceId;
  if (sequenceId === undefined) return null;
  const own =
    card.source.kind === "fader"
      ? slots.find((slot) => slot.index === card.source.slotIndex)
      : undefined;
  if (own?.sequence?.id === sequenceId) return own;
  return slots.find((slot) => slot.sequence?.id === sequenceId) ?? null;
};

/** 下一条存在，且任务列表里还没有这条序列。 */
export const nextSequenceIsFree = (
  items: readonly ChapterItem[],
  sequenceId: number | undefined,
  taskSequenceIds: readonly number[],
): boolean => {
  if (sequenceId === undefined) return false;
  const next = nextChapterSequence(items, sequenceId);
  if (!next) return false;
  return !taskSequenceIds.includes(next.sequence.id);
};
