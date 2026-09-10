import { useCallback, useRef, useState } from "react";
import type { ObjectDeletionImpact } from "@/app/project/project-object-deletion";
import { useObjectDeletion } from "../hooks/use-object-deletion";
import { useProjectStore } from "../hooks/use-project-store";
import { useSelection } from "../hooks/use-selection";
import {
  hasObjectClipboard,
  setObjectClipboard,
  type Vec3Mm,
} from "./object-clipboard";
import {
  pickObjectsInSelectionOrder,
  resolvePastePositionsForMode,
  type PasteMode,
} from "./scene-object-edit";

export type SceneObjectEditActions = {
  copySelection: () => void;
  pasteClipboard: (mode: PasteMode) => void;
  requestDeleteSelection: () => void;
  canCopy: boolean;
  canPaste: boolean;
  canDelete: boolean;
  deleteImpact: ObjectDeletionImpact | null;
  deleteOpen: boolean;
  setDeleteOpen: (open: boolean) => void;
  confirmDelete: () => boolean;
  deleteError: string | null;
};

type UseSceneObjectEditActionsOptions = {
  getPasteAnchorXZ: () => Pick<Vec3Mm, "x" | "z"> | null;
};

export const useSceneObjectEditActions = ({
  getPasteAnchorXZ,
}: UseSceneObjectEditActionsOptions): SceneObjectEditActions => {
  const { objects, cloneObjectsAt, findObject } = useProjectStore();
  const { multiSelectedIds, replaceSelection, clearSelection, setTreeFocus } = useSelection();
  const objectDeletion = useObjectDeletion();
  const [clipEpoch, setClipEpoch] = useState(0);
  const getPasteAnchorXZRef = useRef(getPasteAnchorXZ);
  getPasteAnchorXZRef.current = getPasteAnchorXZ;

  const canCopy = multiSelectedIds.length > 0;
  const canDelete = multiSelectedIds.length > 0;
  void clipEpoch;
  const canPaste = hasObjectClipboard();

  const copySelection = useCallback(() => {
    const ids = multiSelectedIds;
    if (ids.length === 0) return;
    const selectedObjects = pickObjectsInSelectionOrder(objects, ids);
    if (selectedObjects.length === 0) return;
    setObjectClipboard(selectedObjects);
    setClipEpoch((epoch) => epoch + 1);
  }, [multiSelectedIds, objects]);

  const pasteClipboard = useCallback(
    (mode: PasteMode) => {
      const resolved = resolvePastePositionsForMode(mode, () => getPasteAnchorXZRef.current());
      if (!resolved) return;
      const created = cloneObjectsAt(resolved.snapshots, resolved.positions);
      if (created.length === 0) return;
      replaceSelection(created.map((object) => object.id));
      if (resolved.bumped) setClipEpoch((epoch) => epoch + 1);
    },
    [cloneObjectsAt, replaceSelection],
  );

  const pruneObjectSelection = useCallback(
    (removedIds: readonly number[]) => {
      const removed = new Set(removedIds);
      const remaining = multiSelectedIds.filter((id) => !removed.has(id));
      if (remaining.length === 0) {
        clearSelection();
        setTreeFocus(null);
        return;
      }
      replaceSelection(remaining);
    },
    [clearSelection, multiSelectedIds, replaceSelection, setTreeFocus],
  );

  const requestDeleteSelection = useCallback(() => {
    if (multiSelectedIds.length === 0) return;
    objectDeletion.requestDelete(multiSelectedIds);
  }, [multiSelectedIds, objectDeletion]);

  const confirmDelete = useCallback((): boolean => {
    const removedIds = objectDeletion.impact?.objectIds ?? [];
    const outcome = objectDeletion.confirmDelete();
    if (outcome === "deleted") {
      pruneObjectSelection(removedIds);
      return true;
    }
    if (outcome === "no-op") {
      pruneObjectSelection(
        removedIds.length > 0
          ? removedIds
          : multiSelectedIds.filter((id) => !findObject(id)),
      );
      return true;
    }
    return false;
  }, [findObject, multiSelectedIds, objectDeletion, pruneObjectSelection]);

  const handleSetDeleteOpen = useCallback(
    (open: boolean) => {
      if (!open) objectDeletion.cancelDelete();
    },
    [objectDeletion],
  );

  return {
    copySelection,
    pasteClipboard,
    requestDeleteSelection,
    canCopy,
    canPaste,
    canDelete,
    deleteImpact: objectDeletion.impact,
    deleteOpen: objectDeletion.open,
    setDeleteOpen: handleSetDeleteOpen,
    confirmDelete,
    deleteError: objectDeletion.lastError,
  };
};
