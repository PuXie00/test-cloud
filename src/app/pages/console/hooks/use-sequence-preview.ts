import { useContext } from "react";
import { SequencePreviewContext, SequencePreviewPlayingContext } from "./sequence-preview-context";

export type {
  SequencePreviewMultiplier,
  SequencePreviewState,
  SequencePreviewValue,
  StartPreviewOptions,
} from "./sequence-preview-context";

export const useSequencePreview = () => {
  const ctx = useContext(SequencePreviewContext);
  if (!ctx) throw new Error("useSequencePreview must be used inside SequencePreviewProvider");
  return ctx;
};

export const useSequencePreviewPlaying = (): boolean => useContext(SequencePreviewPlayingContext);
