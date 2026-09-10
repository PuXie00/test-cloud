export type PositionHandleId =
  | "x"
  | "y"
  | "z"
  | "xPlane"
  | "yPlane"
  | "zPlane"
  | "viewPlane";

export type PositionHandleHighlight = "idle" | "active" | "dimmed";

export type PositionHandleDragFlags = Record<PositionHandleId, boolean>;

export const resolvePositionHandleHighlight = (input: {
  draggingHandleId: PositionHandleId | null;
  handleId: PositionHandleId;
}): PositionHandleHighlight => {
  if (!input.draggingHandleId) return "idle";
  if (input.draggingHandleId === input.handleId) return "active";
  return "dimmed";
};

export const detectDraggingPositionHandle = (
  flags: PositionHandleDragFlags,
): PositionHandleId | null => {
  if (flags.x) return "x";
  if (flags.y) return "y";
  if (flags.z) return "z";
  if (flags.xPlane) return "xPlane";
  if (flags.yPlane) return "yPlane";
  if (flags.zPlane) return "zPlane";
  if (flags.viewPlane) return "viewPlane";
  return null;
};

/** Visible shafts must not steal picks from collider meshes (cache keys). */
export const shouldPickAxisGizmoMesh = (visibility: number): boolean => visibility <= 0;
