// @vitest-environment jsdom
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { GizmoManager } from "@babylonjs/core/Gizmos/gizmoManager";
import type { IPositionGizmo } from "@babylonjs/core/Gizmos/positionGizmo";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  idleTransformDragSession,
  onTransformDragSettled,
  onTransformDragStart,
  resolveTransformSessionForEpoch,
  shouldPersistTransformDragEnd,
  type TransformDocumentEpoch,
} from "../../pages/console/3d/viz3d-transform-session";
import { resolveContextMenuObjectId } from "../../pages/console/3d/context-menu-pick";
import { THEME_FALLBACK } from "../engine/ThemeBridge";
import { SceneObject } from "../objects/SceneObject";
import {
  shouldShowTransformCenterMarker,
  TransformCenterMarker,
} from "../objects/TransformCenterMarker";
import { SingleTransformPivot } from "./single-transform-pivot";
import { resolveTransformCenterOffset } from "./transform-center";
import { TransformController } from "./TransformController";
import { readWorldTransform } from "./read-world-transform";

type ControllerInternals = {
  gizmoManager: GizmoManager;
};

const epoch = (
  projectId: string | null,
  revision: number,
): TransformDocumentEpoch => ({ projectId, revision });

const getPositionGizmo = (controller: TransformController): IPositionGizmo => {
  const gizmo = (controller as unknown as ControllerInternals).gizmoManager.gizmos
    .positionGizmo;
  if (!gizmo) {
    throw new Error("expected position gizmo");
  }
  return gizmo;
};

describe("TransformController cancel vs physical drag", () => {
  let engine: NullEngine;
  let scene: Scene;
  let node: TransformNode;

  afterEach(() => {
    scene?.dispose();
    engine?.dispose();
    vi.restoreAllMocks();
  });

  const setup = () => {
    engine = new NullEngine();
    scene = new Scene(engine);
    node = new TransformNode("target", scene);
    node.position.set(1, 2, 3);

    const onOrbitToggle = vi.fn();
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const onDragStart = vi.fn();

    const controller = new TransformController(scene, {
      onOrbitToggle,
      onChange,
      onCommit,
      onCancel,
      onDragStart,
    });
    controller.setMode("translate");
    controller.attach(node);

    const gizmo = getPositionGizmo(controller);
    return { controller, gizmo, onOrbitToggle, onChange, onCommit, onCancel, onDragStart };
  };

  const simulateDragStart = (gizmo: IPositionGizmo) => {
    gizmo.onDragStartObservable.notifyObservers({});
  };

  const simulateDragMove = (gizmo: IPositionGizmo, x: number, y: number, z: number) => {
    node.position.set(x, y, z);
    gizmo.onDragObservable.notifyObservers({});
  };

  const simulateDragEnd = (gizmo: IPositionGizmo) => {
    gizmo.onDragEndObservable.notifyObservers({});
  };

  it("Escape mid-drag restores snapshot after continued pointer move and physical dragEnd", () => {
    const { controller, gizmo, onCommit, onCancel, onOrbitToggle } = setup();

    simulateDragStart(gizmo);
    simulateDragMove(gizmo, 10, 20, 30);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(node.position.x).toBeCloseTo(1);
    expect(node.position.y).toBeCloseTo(2);
    expect(node.position.z).toBeCloseTo(3);

    // Babylon gizmo keeps mutating the node until physical drag ends.
    simulateDragMove(gizmo, 40, 50, 60);
    expect(node.position.x).toBeCloseTo(1);
    expect(node.position.y).toBeCloseTo(2);
    expect(node.position.z).toBeCloseTo(3);

    simulateDragEnd(gizmo);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(node.position.x).toBeCloseTo(1);
    expect(node.position.y).toBeCloseTo(2);
    expect(node.position.z).toBeCloseTo(3);
    expect(onOrbitToggle).toHaveBeenCalledWith(true);
  });

  it("pointercancel mid-drag pairs cancel once and restores through physical dragEnd", () => {
    const { gizmo, onCommit, onCancel } = setup();

    simulateDragStart(gizmo);
    simulateDragMove(gizmo, 7, 8, 9);
    window.dispatchEvent(new Event("pointercancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);

    simulateDragMove(gizmo, 11, 12, 13);
    simulateDragEnd(gizmo);

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(node.position.asArray()).toEqual([1, 2, 3]);
  });

  it("restoreAndCancel during drag (rejected beginTrackedEdit) still restores at physical dragEnd", () => {
    const { controller, gizmo, onCommit, onCancel } = setup();

    simulateDragStart(gizmo);
    simulateDragMove(gizmo, 4, 5, 6);
    controller.restoreAndCancel();
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Duplicate cancel from Sync abort must not double-emit.
    controller.restoreAndCancel();
    expect(onCancel).toHaveBeenCalledTimes(1);

    simulateDragMove(gizmo, 100, 0, 0);
    simulateDragEnd(gizmo);

    expect(onCommit).not.toHaveBeenCalled();
    expect(node.position.asArray()).toEqual([1, 2, 3]);
  });

  it("failed commit abort after dragEnd still restores drag-start snapshot", () => {
    const { controller, gizmo, onCommit, onCancel } = setup();
    onCommit.mockImplementation(() => {
      controller.restoreAndCancel();
    });

    simulateDragStart(gizmo);
    simulateDragMove(gizmo, 9, 9, 9);
    simulateDragEnd(gizmo);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(node.position.asArray()).toEqual([1, 2, 3]);
  });

  it("enables planar plane-drag gizmos in translate mode", () => {
    const { gizmo } = setup();
    expect(gizmo.scaleRatio).toBe(0.5);
    expect(gizmo.planarGizmoEnabled).toBe(true);
    expect(gizmo.xPlaneGizmo.isEnabled).toBe(true);
    expect(gizmo.yPlaneGizmo.isEnabled).toBe(true);
    expect(gizmo.zPlaneGizmo.isEnabled).toBe(true);
  });

  it("keeps visible axis shafts unpickable so collider cache keys stay valid", () => {
    const { gizmo } = setup();
    const visible = gizmo.xGizmo._rootMesh
      .getChildMeshes(false)
      .filter((mesh) => mesh.visibility > 0);
    const colliders = gizmo.xGizmo._rootMesh
      .getChildMeshes(false)
      .filter((mesh) => mesh.visibility <= 0);
    expect(visible.length).toBeGreaterThan(0);
    expect(colliders.length).toBeGreaterThan(0);
    expect(visible.every((mesh) => !mesh.isPickable)).toBe(true);
    expect(colliders.every((mesh) => mesh.isPickable)).toBe(true);
  });

  it("unbinds Escape listener after cancel so later Escape is inert", () => {
    const { gizmo, onCancel } = setup();

    simulateDragStart(gizmo);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("transform session document epoch guard", () => {
  it("refuses persist when project id or revision changes (open/restore)", () => {
    const start = epoch("proj-a", 3);
    const owned = onTransformDragStart(true, start);
    const rejected = onTransformDragStart(false, start);

    expect(shouldPersistTransformDragEnd(owned, start)).toBe(true);
    expect(shouldPersistTransformDragEnd(owned, epoch("proj-a", 4))).toBe(false);
    expect(shouldPersistTransformDragEnd(owned, epoch("proj-b", 3))).toBe(false);
    expect(shouldPersistTransformDragEnd(rejected, start)).toBe(false);
    expect(shouldPersistTransformDragEnd(idleTransformDragSession(), start)).toBe(false);
  });

  it("resolveTransformSessionForEpoch aborts active/rejected drag into idle on version-restore epoch", () => {
    const start = epoch("proj-a", 1);
    const restored = epoch("proj-a", 2);

    const ownedResolution = resolveTransformSessionForEpoch(
      onTransformDragStart(true, start),
      restored,
    );
    expect(ownedResolution).toEqual({
      session: idleTransformDragSession(),
      shouldAbortEngine: true,
      shouldCancelTrackedEdit: true,
    });

    const rejectedResolution = resolveTransformSessionForEpoch(
      onTransformDragStart(false, start),
      restored,
    );
    expect(rejectedResolution).toEqual({
      session: idleTransformDragSession(),
      shouldAbortEngine: true,
      shouldCancelTrackedEdit: false,
    });

    expect(
      resolveTransformSessionForEpoch(onTransformDragStart(true, start), start),
    ).toEqual({
      session: onTransformDragStart(true, start),
      shouldAbortEngine: false,
      shouldCancelTrackedEdit: false,
    });

    expect(onTransformDragSettled()).toEqual(idleTransformDragSession());
  });
});

describe("transform center", () => {
  it("resolves geometry, top, bottom, and reset presets", () => {
    const dimensions = { w: 4, h: 2, d: 3 };

    expect(resolveTransformCenterOffset("geometry", dimensions)).toEqual({ x: 0, y: 0, z: 0 });
    expect(resolveTransformCenterOffset("top", dimensions)).toEqual({ x: 0, y: 1, z: 0 });
    expect(resolveTransformCenterOffset("bottom", dimensions)).toEqual({ x: 0, y: -1, z: 0 });
    expect(resolveTransformCenterOffset("reset", dimensions)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("attaches at a custom center without moving the object and preserves its pose on release", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const object = new TransformNode("object", scene);
    object.position.set(2, 3, 4);
    object.computeWorldMatrix(true);
    const before = object.getAbsolutePosition().clone();
    const transformCenter = new SingleTransformPivot(scene);

    transformCenter.attach(object, { x: 2, y: 4, z: 4 });
    object.computeWorldMatrix(true);
    expect(object.getAbsolutePosition().asArray()).toEqual(before.asArray());

    transformCenter.pivot.rotation.z = Math.PI / 2;
    transformCenter.pivot.computeWorldMatrix(true);
    object.computeWorldMatrix(true);
    const transformed = object.getAbsolutePosition().clone();
    transformCenter.release();
    object.computeWorldMatrix(true);

    expect(object.parent).toBeNull();
    expect(object.getAbsolutePosition().asArray()).toEqual(transformed.asArray());

    transformCenter.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("keeps local position unchanged while the gizmo pivot moves, so persist must read world pose", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const object = new TransformNode("object", scene);
    object.position.set(2, 3, 4);
    object.computeWorldMatrix(true);
    const transformCenter = new SingleTransformPivot(scene);

    transformCenter.attach(object, { x: 2, y: 3, z: 4 });
    const localBefore = {
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
    };

    transformCenter.pivot.position.set(12, 3, 4);
    transformCenter.pivot.rotation.set(0, 0.7, 0);
    transformCenter.pivot.computeWorldMatrix(true);
    object.computeWorldMatrix(true);

    expect(object.position.x).toBeCloseTo(localBefore.x);
    expect(object.position.y).toBeCloseTo(localBefore.y);
    expect(object.position.z).toBeCloseTo(localBefore.z);
    expect(object.rotation.y).toBeCloseTo(0);
    expect(object.getAbsolutePosition().x).toBeCloseTo(12);

    const world = readWorldTransform(object);
    expect(world.position.x).toBeCloseTo(12);
    expect(world.position.y).toBeCloseTo(3);
    expect(world.position.z).toBeCloseTo(4);
    expect(world.rotation.y).toBeCloseTo(0.7);

    transformCenter.release();
    object.computeWorldMatrix(true);

    expect(object.position.x).toBeCloseTo(12);
    expect(object.position.y).toBeCloseTo(3);
    expect(object.position.z).toBeCloseTo(4);

    transformCenter.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("restores the original scene parent after a centered transform", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const group = new TransformNode("group", scene);
    const object = new TransformNode("object", scene);
    object.parent = group;
    const transformCenter = new SingleTransformPivot(scene);

    transformCenter.attach(object, { x: 0, y: 1, z: 0 });
    transformCenter.release();

    expect(object.parent).toBe(group);

    transformCenter.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("changes the model transform center without moving the model or motion basis", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const object = new SceneObject(
      {
        id: "co-transform-center",
        shape: "cube",
        dimensions: { w: 2, h: 1, d: 1 },
        position: { x: 3, y: 4, z: 5 },
        centerOffset: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: "#869398",
      },
      scene,
      THEME_FALLBACK,
    );
    object.root.computeWorldMatrix(true);
    object.runtimePivot.computeWorldMatrix(true);
    object.selectionBoundsTarget.computeWorldMatrix(true);
    const rootBefore = object.root.getAbsolutePosition().clone();
    const motionBasisBefore = object.runtimePivot.getAbsolutePosition().clone();
    const visualBefore = object.selectionBoundsTarget.getAbsolutePosition().clone();

    object.setCenterOffset({ x: 0, y: 0.5, z: 0 });
    object.root.computeWorldMatrix(true);
    object.runtimePivot.computeWorldMatrix(true);
    object.selectionBoundsTarget.computeWorldMatrix(true);

    expect(object.root.getAbsolutePosition().asArray()).toEqual(rootBefore.asArray());
    expect(object.runtimePivot.getAbsolutePosition().asArray()).toEqual(motionBasisBefore.asArray());
    expect(object.selectionBoundsTarget.getAbsolutePosition().asArray()).toEqual(
      visualBefore.asArray(),
    );
    expect(object.getTransformCenterWorldPosition()).toEqual({ x: 3, y: 4.5, z: 5 });

    object.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("shows transform-center commands only for a model under the pointer", () => {
    expect(resolveContextMenuObjectId({ kind: "object", id: "co-1" })).toBe("co-1");
    expect(resolveContextMenuObjectId({ kind: "motor", id: "motor-1" })).toBeNull();
    expect(resolveContextMenuObjectId(null)).toBeNull();
  });

  it("shows the transform-center marker only for one selected object in scene-edit mode", () => {
    expect(shouldShowTransformCenterMarker("select", ["co-1"], true)).toBe(true);
    expect(shouldShowTransformCenterMarker("select", [], true)).toBe(false);
    expect(shouldShowTransformCenterMarker("select", ["co-1", "co-2"], true)).toBe(false);
    expect(shouldShowTransformCenterMarker("translate", ["co-1"], true)).toBe(false);
    expect(shouldShowTransformCenterMarker("select", ["co-1"], false)).toBe(false);
  });

  it("updates and hides the warning transform-center marker", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const marker = new TransformCenterMarker(scene, THEME_FALLBACK.warning);

    marker.show({ x: 1, y: 2, z: 3 }, 0.2);
    expect(marker.root.isEnabled()).toBe(true);
    expect(marker.root.position.asArray()).toEqual([1, 2, 3]);
    expect(marker.root.scaling.asArray()).toEqual([0.2, 0.2, 0.2]);

    marker.hide();
    expect(marker.root.isEnabled()).toBe(false);

    marker.dispose();
    scene.dispose();
    engine.dispose();
  });
});
