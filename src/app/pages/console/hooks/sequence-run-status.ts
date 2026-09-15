import type { ChapterItem } from "../components/program-panel/program-data";

export type SequenceRunStatusItem = {
  sequenceId: number;
  elapsedMs: number;
  totalMs: number;
  remainingMs: number;
  loopCount: number;
  speedPercent: number;
  status: "running" | "stopped";
};

export const EXAMPLE_SEQUENCE_RUNTIME: readonly SequenceRunStatusItem[] = [
  {
    sequenceId: 1,
    elapsedMs: 12300,
    totalMs: 60000,
    remainingMs: 47700,
    loopCount: 1,
    speedPercent: 100,
    status: "running",
  },
];

export const formatExecTime = (ms: number): string => {
  const totalSeconds = ms / 1000;
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
};

export const hasNextChapterSequence = (
  items: readonly ChapterItem[],
  sequenceId: number,
): boolean => {
  const index = items.findIndex((entry) => entry.sequence.id === sequenceId);
  if (index < 0) return false;
  return items.slice(index + 1).some((entry) => entry.kind === "sequence");
};
