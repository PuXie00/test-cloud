import { useEffect, useMemo, useRef } from "react";
import { useConsoleNav } from "../../hooks/use-console-nav";
import { useSelection } from "../../hooks/use-selection";
import { useActionBuilder } from "./use-action-builder";
import { useProjectStore } from "../../hooks/use-project-store";

const sameIdList = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/** Syncs global 3D / monitor selection into action builder object selection. */
export const ActionBuilderSelectionSync = () => {
  const { activeNav } = useConsoleNav();
  const { selectedId, multiSelectedIds, objectSelectGeneration } = useSelection();
  const { selection, selectedObjectIds, handleObjectsSelect } = useActionBuilder();
  const { objects } = useProjectStore();
  const prevSourceKeyRef = useRef<string | null>(null);
  const prevGenerationRef = useRef<number | null>(null);

  const projectObjectIdsKey = useMemo(
    () => objects.map((object) => object.id).join("\0"),
    [objects],
  );

  const projectObjectIdSet = useMemo(
    () => new Set(objects.map((object) => object.id)),
    [projectObjectIdsKey],
  );

  const selectionSourceKey = useMemo(() => {
    const sourceIds =
      multiSelectedIds.length > 0 ? multiSelectedIds : selectedId != null ? [selectedId] : [];
    return sourceIds.join("\0");
  }, [selectedId, multiSelectedIds]);

  useEffect(() => {
    if (activeNav !== "sequences") {
      prevSourceKeyRef.current = selectionSourceKey;
      prevGenerationRef.current = objectSelectGeneration;
      return;
    }

    const sourceChanged =
      prevSourceKeyRef.current !== null && prevSourceKeyRef.current !== selectionSourceKey;
    const generationChanged =
      prevGenerationRef.current !== null && prevGenerationRef.current !== objectSelectGeneration;
    prevSourceKeyRef.current = selectionSourceKey;
    prevGenerationRef.current = objectSelectGeneration;

    const sourceIds =
      selectionSourceKey.length > 0
        ? selectionSourceKey.split("\0").map(Number).filter((id) => Number.isFinite(id))
        : [];

    const timelineIds = sourceIds.filter((id) => projectObjectIdSet.has(id));
    const nextIds = timelineIds.length > 0 ? timelineIds : sourceIds.length === 0 ? [] : selectedObjectIds;

    if (sourceIds.length > 0 && timelineIds.length === 0) {
      return;
    }

    const hasTimelineSelection = selection !== null;
    if (hasTimelineSelection) {
      if (sourceChanged || generationChanged) {
        handleObjectsSelect(nextIds);
      }
      return;
    }

    if (sameIdList(nextIds, selectedObjectIds)) return;
    handleObjectsSelect(nextIds);
  }, [
    activeNav,
    selection,
    selectionSourceKey,
    objectSelectGeneration,
    projectObjectIdSet,
    selectedObjectIds,
    handleObjectsSelect,
  ]);

  return null;
};
