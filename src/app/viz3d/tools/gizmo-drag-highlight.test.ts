import { describe, expect, it } from "vitest";
import {
  detectDraggingPositionHandle,
  resolvePositionHandleHighlight,
  shouldPickAxisGizmoMesh,
  type PositionHandleDragFlags,
} from "./gizmo-drag-highlight";

const idleFlags: PositionHandleDragFlags = {
  x: false,
  y: false,
  z: false,
  xPlane: false,
  yPlane: false,
  zPlane: false,
  viewPlane: false,
};

describe("resolvePositionHandleHighlight", () => {
  it("keeps every handle idle when nothing is dragging", () => {
    expect(resolvePositionHandleHighlight({ draggingHandleId: null, handleId: "x" })).toBe("idle");
    expect(resolvePositionHandleHighlight({ draggingHandleId: null, handleId: "yPlane" })).toBe(
      "idle",
    );
  });

  it("keeps the active handle bright and dims the rest", () => {
    expect(resolvePositionHandleHighlight({ draggingHandleId: "x", handleId: "x" })).toBe("active");
    expect(resolvePositionHandleHighlight({ draggingHandleId: "x", handleId: "y" })).toBe("dimmed");
    expect(resolvePositionHandleHighlight({ draggingHandleId: "x", handleId: "xPlane" })).toBe(
      "dimmed",
    );
    expect(resolvePositionHandleHighlight({ draggingHandleId: "x", handleId: "viewPlane" })).toBe(
      "dimmed",
    );
  });

  it("dims axes while a plane handle is dragging", () => {
    expect(resolvePositionHandleHighlight({ draggingHandleId: "zPlane", handleId: "zPlane" })).toBe(
      "active",
    );
    expect(resolvePositionHandleHighlight({ draggingHandleId: "zPlane", handleId: "z" })).toBe(
      "dimmed",
    );
  });
});

describe("detectDraggingPositionHandle", () => {
  it("returns null when no handle is dragging", () => {
    expect(detectDraggingPositionHandle(idleFlags)).toBeNull();
  });

  it("prefers the axis that is currently dragging", () => {
    expect(detectDraggingPositionHandle({ ...idleFlags, y: true })).toBe("y");
    expect(detectDraggingPositionHandle({ ...idleFlags, xPlane: true })).toBe("xPlane");
    expect(detectDraggingPositionHandle({ ...idleFlags, viewPlane: true })).toBe("viewPlane");
  });
});

describe("shouldPickAxisGizmoMesh", () => {
  it("only colliders (hidden) stay pickable so hover cache keys match", () => {
    expect(shouldPickAxisGizmoMesh(0)).toBe(true);
    expect(shouldPickAxisGizmoMesh(1)).toBe(false);
  });
});
