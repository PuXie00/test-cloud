import { createContext } from "react";
import type { ResolvedActionSequence } from "@/app/project/action-sequence/resolve-sequence";

export type SequencePreviewMultiplier = 1 | 2 | 4;

export type SequencePreviewState = {
  sequenceId: number | null;
  cursorMs: number;
  isPlaying: boolean;
  holdMode: boolean;
  faderPercent: number;
  multiplier: SequencePreviewMultiplier;
  totalMs: number;
  resolved: ResolvedActionSequence | null;
};

export type StartPreviewOptions = { faderPercent?: number; autoplay?: boolean; holdMode?: boolean };

export type SequencePreviewValue = SequencePreviewState & {
  startPreview: (sequenceId: number, options?: StartPreviewOptions) => void;
  togglePreview: (sequenceId: number, options?: StartPreviewOptions) => void;
  stopPreview: () => void;
  setCursorMs: (ms: number) => void;
  play: () => void;
  pause: () => void;
  setMultiplier: (m: SequencePreviewMultiplier) => void;
};

export const SequencePreviewContext = createContext<SequencePreviewValue | null>(null);
