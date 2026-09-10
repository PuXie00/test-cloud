import { useEffect, useRef } from "react";
import type { TransformEndPayload } from "@/app/viz3d";
import { useProject } from "@/app/project/use-project";
import { useProjectStore } from "../hooks/use-project-store";
import { useViz3DContext } from "./Viz3DProvider";
import { persistTransformPayloads, persistTransformPayloadsBatch } from "./viz3d-transform-persist";
import {
  idleTransformDragSession,
  onTransformDragSettled,
  onTransformDragStart,
  resolveTransformSessionForEpoch,
  shouldAbortEngineOnTransformStart,
  shouldPersistTransformDragEnd,
  TRANSFORM_EDIT_LABEL,
  TRANSFORM_EDIT_OWNER,
  type TransformDocumentEpoch,
  type TransformDragSession,
} from "./viz3d-transform-session";

export const Viz3DTransformSync = () => {
  const engine = useViz3DContext();
  const { updateObject, updateObjectsBatch, findObject } = useProjectStore();
  const {
    beginTrackedEdit,
    commitTrackedEdit,
    cancelTrackedEdit,
    currentProject,
    documentRevision,
  } = useProject();
  const sessionRef = useRef<TransformDragSession>(idleTransformDragSession());
  const epochRef = useRef<TransformDocumentEpoch>({
    projectId: currentProject?.id ?? null,
    revision: documentRevision.value,
  });
  epochRef.current = {
    projectId: currentProject?.id ?? null,
    revision: documentRevision.value,
  };

  useEffect(() => {
    const currentEpoch = epochRef.current;
    const resolution = resolveTransformSessionForEpoch(sessionRef.current, currentEpoch);
    if (resolution.shouldAbortEngine || resolution.shouldCancelTrackedEdit) {
      if (resolution.shouldCancelTrackedEdit) {
        cancelTrackedEdit(TRANSFORM_EDIT_OWNER);
      }
      sessionRef.current = resolution.session;
      if (resolution.shouldAbortEngine) {
        engine.abortTransformDrag();
      }
    }
  }, [currentProject?.id, documentRevision.value, engine, cancelTrackedEdit]);

  useEffect(() => {
    const handleTransformStart = () => {
      const session = onTransformDragStart(
        beginTrackedEdit(TRANSFORM_EDIT_OWNER, TRANSFORM_EDIT_LABEL),
        epochRef.current,
      );
      sessionRef.current = session;
      if (shouldAbortEngineOnTransformStart(session)) {
        engine.abortTransformDrag();
      }
    };

    const handleTransformEnd = (payload: TransformEndPayload) => {
      const session = sessionRef.current;
      const canCommitHistory = shouldPersistTransformDragEnd(session, epochRef.current);
      persistTransformPayloads(updateObject, [payload], (id) => findObject(id)?.controlType);
      if (canCommitHistory) {
        commitTrackedEdit(TRANSFORM_EDIT_OWNER);
      } else if (session.status === "owned") {
        cancelTrackedEdit(TRANSFORM_EDIT_OWNER);
      }
      sessionRef.current = onTransformDragSettled();
    };

    const handleTransformEndBatch = (payloads: TransformEndPayload[]) => {
      const session = sessionRef.current;
      const canCommitHistory = shouldPersistTransformDragEnd(session, epochRef.current);
      persistTransformPayloadsBatch(updateObjectsBatch, payloads, (id) => findObject(id)?.controlType);
      if (canCommitHistory) {
        commitTrackedEdit(TRANSFORM_EDIT_OWNER);
      } else if (session.status === "owned") {
        cancelTrackedEdit(TRANSFORM_EDIT_OWNER);
      }
      sessionRef.current = onTransformDragSettled();
    };

    const handleTransformCancel = () => {
      if (sessionRef.current.status === "owned") {
        cancelTrackedEdit(TRANSFORM_EDIT_OWNER);
      }
      sessionRef.current = onTransformDragSettled();
    };

    engine.events.on("transformStart", handleTransformStart);
    engine.events.on("transformEnd", handleTransformEnd);
    engine.events.on("transformEndBatch", handleTransformEndBatch);
    engine.events.on("transformCancel", handleTransformCancel);
    return () => {
      engine.events.off("transformStart", handleTransformStart);
      engine.events.off("transformEnd", handleTransformEnd);
      engine.events.off("transformEndBatch", handleTransformEndBatch);
      engine.events.off("transformCancel", handleTransformCancel);
      if (sessionRef.current.status === "owned") {
        cancelTrackedEdit(TRANSFORM_EDIT_OWNER);
      }
      sessionRef.current = onTransformDragSettled();
    };
  }, [
    engine,
    updateObject,
    updateObjectsBatch,
    findObject,
    beginTrackedEdit,
    commitTrackedEdit,
    cancelTrackedEdit,
  ]);

  return null;
};
