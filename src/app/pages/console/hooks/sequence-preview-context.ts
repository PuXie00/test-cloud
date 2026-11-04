import { createContext } from "react";
import type { ResolvedActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { PreviewTimeline } from "./sequence-preview-timeline";

export type SequencePreviewMultiplier = 1 | 2 | 5 | 10;

/** 预览倍速档位；进入预览默认 5 倍，最高 10 倍（再乘推子的速度百分比） */
export const PREVIEW_MULTIPLIERS: readonly SequencePreviewMultiplier[] = [1, 2, 5, 10];
export const DEFAULT_PREVIEW_MULTIPLIER: SequencePreviewMultiplier = 5;

export type SequencePreviewState = {
  sequenceId: number | null;
  cursorMs: number;
  isPlaying: boolean;
  holdMode: boolean;
  faderPercent: number;
  multiplier: SequencePreviewMultiplier;
  /** 预览时间轴总长：过渡段 + 剩余编程段 */
  totalMs: number;
  resolved: ResolvedActionSequence | null;
  timeline: PreviewTimeline | null;
};

export type StartPreviewOptions = {
  faderPercent?: number;
  /** 进入后直接播放；默认 true */
  autoplay?: boolean;
  holdMode?: boolean;
  nearest?: boolean;
  reverse?: boolean;
};

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
