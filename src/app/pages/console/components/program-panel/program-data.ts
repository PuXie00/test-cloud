import type { TrajectoryMode } from "@shared/action-sequence";

export const PROGRAM_SLOTS_PER_PAGE = 8;

export type ActionSequence = {
  id: number;
  name: string;
  note?: string;
  /** Display duration from `resolveActionSequence`; not an authored field. */
  durationMs: number;
  /** Missing or `non-forced` is unmarked on the control page. */
  trajectoryMode?: TrajectoryMode;
};

export type ChapterItem = {
  kind: "sequence";
  sequence: ActionSequence;
};

export type Chapter = {
  id: string;
  name: string;
  note?: string;
  items: ChapterItem[];
};

export type Program = {
  id: string;
  name: string;
  note?: string;
  chapters: Chapter[];
};
