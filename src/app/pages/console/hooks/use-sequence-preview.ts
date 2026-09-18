import { useContext } from "react";
import { SequencePreviewContext } from "./sequence-preview-context";

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
