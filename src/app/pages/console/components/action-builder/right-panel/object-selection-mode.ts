import type { EditorDockMode } from "../action-builder-context-types";
import type { SequenceSelection } from "../sequence-selection";

export type ObjectSelectionMode = "sequence" | "empty";

export const objectSelectionModeFromDock = (dockMode: EditorDockMode): ObjectSelectionMode => {
  if (dockMode === "sequence") return "sequence";
  return "empty";
};

export const preferSequenceProperties = (
  dockMode: EditorDockMode,
  selection: SequenceSelection,
): boolean => dockMode === "sequence" && selection !== null;
