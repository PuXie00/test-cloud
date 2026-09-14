import { useEffect, useRef } from "react";
import { useSelection } from "../hooks/use-selection";
import { useViz3DContext } from "./Viz3DProvider";
import {
  resolveMonitorObjectIds,
  sameIdList,
  toEngineObjectIds,
  toProjectObjectIds,
} from "./viz3d-selection-sync";

export const Viz3DSelectionSync = () => {
  const engine = useViz3DContext();
  const { selectedId, multiSelectedIds, replaceSelection, touchObjectSelection, treeFocus } =
    useSelection();
  const applyingFromEngine = useRef(false);
  const applyingFromMonitor = useRef(false);
  const monitorIdsRef = useRef<number[]>([]);

  monitorIdsRef.current = resolveMonitorObjectIds(selectedId, multiSelectedIds);

  useEffect(() => {
    const handleEngineSelection = (engineIds: string[]) => {
      if (applyingFromMonitor.current) {
        return;
      }

      const projectIds = toProjectObjectIds(engineIds, (id) => engine.resolveSnapshotId(id));

      if (projectIds.length === 0) {
        if (engineIds.length === 0) {
          applyingFromEngine.current = true;
          replaceSelection([]);
        }
        return;
      }

      if (sameIdList(projectIds, monitorIdsRef.current)) {
        touchObjectSelection();
        return;
      }

      applyingFromEngine.current = true;
      replaceSelection(projectIds);
    };

    engine.events.on("selectionChange", handleEngineSelection);
    return () => {
      engine.events.off("selectionChange", handleEngineSelection);
    };
  }, [engine, replaceSelection, touchObjectSelection]);

  useEffect(() => {
    const pushMonitorSelectionToEngine = () => {
      if (applyingFromEngine.current) {
        applyingFromEngine.current = false;
        return;
      }

      if (engine.getMotorSelection() !== null || treeFocus?.kind === "motor") {
        return;
      }

      const projectIds = monitorIdsRef.current;
      const engineIds = toEngineObjectIds(projectIds, (id) => engine.resolveObjectId(String(id)));

      if (sameIdList(engineIds, engine.getSelection())) {
        return;
      }

      applyingFromMonitor.current = true;
      engine.setSelection(engineIds);
      applyingFromMonitor.current = false;
    };

    pushMonitorSelectionToEngine();
    engine.events.on("ready", pushMonitorSelectionToEngine);
    return () => {
      engine.events.off("ready", pushMonitorSelectionToEngine);
    };
  }, [engine, selectedId, multiSelectedIds, treeFocus]);

  return null;
};
