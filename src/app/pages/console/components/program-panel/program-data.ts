export const PROGRAM_SLOTS_PER_PAGE = 16;

export type ActionSequence = {
  id: number;
  name: string;
  note?: string;
  /** Display duration from `resolveActionSequence`; not an authored field. */
  durationMs: number;
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
