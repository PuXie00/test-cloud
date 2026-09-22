import type { TrajectoryMode } from "@shared/action-sequence";

export const PROGRAM_SLOTS_PER_PAGE = 12;

export type ActionSequence = {
  id: number;
  name: string;
  note?: string;
  /** Display duration from `resolveActionSequence`; not an authored field. */
  durationMs: number;
  /** Missing or `non-forced` is unmarked on the control page. */
  trajectoryMode?: TrajectoryMode;
  /** Closed-path repeat. Missing or false stays unmarked on the fader. */
  loop?: boolean;
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
