/** Pure helpers for 3D transform transaction pairing (start / end / cancel). */

export const TRANSFORM_EDIT_OWNER = "viz3d-transform";
export const TRANSFORM_EDIT_LABEL = "移动受控物体";

export type TransformDocumentEpoch = {
  projectId: string | null;
  revision: number;
};

export type TransformDragSession =
  | { status: "idle" }
  | { status: "owned"; epoch: TransformDocumentEpoch }
  | { status: "rejected"; epoch: TransformDocumentEpoch };

const DEFAULT_EPOCH: TransformDocumentEpoch = { projectId: null, revision: Number.NaN };

export const idleTransformDragSession = (): TransformDragSession => ({ status: "idle" });

export const sameTransformDocumentEpoch = (
  left: TransformDocumentEpoch,
  right: TransformDocumentEpoch,
): boolean => left.projectId === right.projectId && left.revision === right.revision;

export const onTransformDragStart = (
  begun: boolean,
  epoch: TransformDocumentEpoch = DEFAULT_EPOCH,
): TransformDragSession => (begun ? { status: "owned", epoch } : { status: "rejected", epoch });

export const shouldAbortEngineOnTransformStart = (session: TransformDragSession): boolean =>
  session.status === "rejected";

export const shouldPersistTransformDragEnd = (
  session: TransformDragSession,
  currentEpoch?: TransformDocumentEpoch,
): boolean => {
  if (session.status !== "owned") {
    return false;
  }
  if (currentEpoch === undefined) {
    return true;
  }
  return sameTransformDocumentEpoch(session.epoch, currentEpoch);
};

export const resolveTransformSessionForEpoch = (
  session: TransformDragSession,
  currentEpoch: TransformDocumentEpoch,
): {
  session: TransformDragSession;
  shouldAbortEngine: boolean;
  shouldCancelTrackedEdit: boolean;
} => {
  if (session.status === "idle") {
    return {
      session,
      shouldAbortEngine: false,
      shouldCancelTrackedEdit: false,
    };
  }
  if (sameTransformDocumentEpoch(session.epoch, currentEpoch)) {
    return {
      session,
      shouldAbortEngine: false,
      shouldCancelTrackedEdit: false,
    };
  }
  return {
    session: idleTransformDragSession(),
    shouldAbortEngine: true,
    shouldCancelTrackedEdit: session.status === "owned",
  };
};

export const onTransformDragSettled = (): TransformDragSession => idleTransformDragSession();
