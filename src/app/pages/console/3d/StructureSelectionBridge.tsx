import { useEffect } from "react";
import { useSelection } from "../hooks/use-selection";
import { useViz3DContext } from "./Viz3DProvider";

export const StructureSelectionBridge = () => {
  const engine = useViz3DContext();
  const { multiSelectedIds, treeFocus, setTreeFocus } = useSelection();

  useEffect(() => {
    if (
      engine.getMotorSelection() !== null ||
      treeFocus?.kind === "motor" ||
      treeFocus?.kind === "master"
    ) {
      return;
    }

    if (multiSelectedIds.length === 1) {
      const id = multiSelectedIds[0];
      if (treeFocus?.kind === "controlled-object" && treeFocus.id === id) {
        return;
      }
      setTreeFocus({ kind: "controlled-object", id });
    }
  }, [engine, multiSelectedIds, treeFocus, setTreeFocus]);

  return null;
};
