export type PositionCue = {
  id: string;
  name: string;
  note?: string;
  durationMs: number;
  targets: Record<string, number>;
};

export type ActionSequence = {
  id: string;
  name: string;
  note?: string;
  /** Display duration from `resolveActionSequence`; not an authored field. */
  durationMs: number;
};

export type ChapterItem =
  | { kind: "cue"; cue: PositionCue }
  | { kind: "sequence"; sequence: ActionSequence };

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
