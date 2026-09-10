import type { EditorDockMode } from "../action-builder-context-types";
import type { SequenceSelection } from "../sequence-selection";

export type ObjectSelectionMode = "cue" | "sequence" | "empty";

export const objectSelectionModeFromDock = (dockMode: EditorDockMode): ObjectSelectionMode => {
  if (dockMode === "cue") return "cue";
  if (dockMode === "sequence") return "sequence";
  return "empty";
};

export const idsNotInCue = (
  selectedObjectIds: readonly number[],
  cueObjectIds: readonly number[],
): number[] => {
  const inCue = new Set(cueObjectIds);
  return selectedObjectIds.filter((id) => !inCue.has(id));
};

export const preferSequenceProperties = (
  dockMode: EditorDockMode,
  selection: SequenceSelection,
): boolean => dockMode === "sequence" && selection !== null;
