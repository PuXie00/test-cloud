import { useCallback, useMemo, useState } from "react";
import {
  analyzeObjectDeletion,
  type ObjectDeletionImpact,
} from "@/app/project/project-object-deletion";
import { useProject } from "@/app/project/use-project";
import { useProjectStore } from "./use-project-store";

export type ObjectDeletionConfirmResult = "deleted" | "refreshed" | "no-op" | "failed";

export type ObjectDeletionController = {
  impact: ObjectDeletionImpact | null;
  open: boolean;
  lastError: string | null;
  requestDelete: (objectIds: readonly number[]) => void;
  cancelDelete: () => void;
  confirmDelete: () => ObjectDeletionConfirmResult;
};

export const useObjectDeletion = (): ObjectDeletionController => {
  const { currentProject, currentConfigurationStateId } = useProject();
  const { removeObjects } = useProjectStore();
  const [impact, setImpact] = useState<ObjectDeletionImpact | null>(null);
  const [open, setOpen] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const requestDelete = useCallback(
    (objectIds: readonly number[]) => {
      const document = currentProject?.document;
      const stateId = currentConfigurationStateId;
      if (!document || !stateId) return;

      const nextImpact = analyzeObjectDeletion(document, objectIds, stateId);
      if (nextImpact.objectIds.length === 0) return;

      setLastError(null);
      setImpact(nextImpact);
      setOpen(true);
    },
    [currentConfigurationStateId, currentProject?.document],
  );

  const cancelDelete = useCallback(() => {
    setOpen(false);
    setImpact(null);
    setLastError(null);
  }, []);

  const confirmDelete = useCallback((): ObjectDeletionConfirmResult => {
    if (!impact) return "no-op";

    const document = currentProject?.document;
    const stateId = currentConfigurationStateId;
    if (!document || !stateId) {
      setLastError("当前没有可更新的工程文档");
      return "failed";
    }

    if (stateId !== impact.stateId) {
      const refreshed = analyzeObjectDeletion(document, impact.objectIds, stateId);
      if (refreshed.objectIds.length === 0) {
        setOpen(false);
        setImpact(null);
        setLastError(null);
        return "no-op";
      }
      setImpact(refreshed);
      setLastError(null);
      return "refreshed";
    }

    if (impact.objectIds.length === 0) {
      setOpen(false);
      setImpact(null);
      setLastError(null);
      return "no-op";
    }

    const result = removeObjects(impact.objectIds);
    if (!result.ok) {
      setLastError(result.reason);
      return "failed";
    }

    setOpen(false);
    setImpact(null);
    setLastError(null);
    return result.changed ? "deleted" : "no-op";
  }, [currentConfigurationStateId, currentProject?.document, impact, removeObjects]);

  return useMemo(
    () => ({
      impact,
      open,
      lastError,
      requestDelete,
      cancelDelete,
      confirmDelete,
    }),
    [cancelDelete, confirmDelete, impact, lastError, open, requestDelete],
  );
};
