import { useEffect, useMemo } from "react";
import { useProject } from "@/app/project/use-project";
import { useActionBuilder } from "../components/action-builder/use-action-builder";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useSequencePreview } from "../hooks/sequence-preview-provider";
import { useProjectStore } from "../hooks/use-project-store";
import { useSelection } from "../hooks/use-selection";
import { resolveDimmedObjectIds } from "./membership-dim";
import { resolveMonitorObjectIds } from "./viz3d-selection-sync";
import { useViz3DContext } from "./Viz3DProvider";

/** 动作页：把「非当前序列成员」推给引擎变淡；离开动作页或卸载时全部恢复 */
export const Viz3DMembershipDimSync = () => {
  const engine = useViz3DContext();
  const { activeNav } = useConsoleNav();
  const { objects } = useProjectStore();
  const { selectedId, multiSelectedIds } = useSelection();
  const { dockMode, sequence } = useActionBuilder();
  const { sequenceId } = useSequencePreview();
  const { currentProject } = useProject();

  const controlPreviewSequence = useMemo(() => {
    if (sequenceId === null) return null;
    return (
      currentProject?.document.motion.actionSequences.find((item) => item.id === sequenceId) ?? null
    );
  }, [sequenceId, currentProject]);

  const allObjectIds = useMemo(() => objects.map((object) => object.id), [objects]);
  const pickedObjectIds = useMemo(
    () => resolveMonitorObjectIds(selectedId, multiSelectedIds),
    [selectedId, multiSelectedIds],
  );

  const dimmedIds = useMemo(
    () =>
      resolveDimmedObjectIds({
        activeNav,
        dockMode,
        sequence,
        controlPreviewSequence,
        allObjectIds,
        pickedObjectIds,
      }).map(String),
    [activeNav, dockMode, sequence, controlPreviewSequence, allObjectIds, pickedObjectIds],
  );

  useEffect(() => {
    const push = () => engine.setDimmedObjects(dimmedIds);
    push();
    engine.events.on("ready", push);
    return () => {
      engine.events.off("ready", push);
    };
  }, [engine, dimmedIds]);

  useEffect(() => () => engine.setDimmedObjects([]), [engine]);

  return null;
};
