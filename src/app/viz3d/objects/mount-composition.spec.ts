import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { THEME_FALLBACK } from "../engine/ThemeBridge";
import { resolveVirtualAxisTransform } from "../telemetry/virtual-axis-mapper";
import { applyWorldTransformUnderParent, readWorldTransform } from "../tools/read-world-transform";
import { GoShadowController } from "../state/GoShadowController";
import { SequencePreviewController } from "../state/SequencePreviewController";
import type { SceneObjectConfig } from "../types";
import { SceneObject } from "./SceneObject";
import { SceneObjectRegistry } from "./SceneObjectRegistry";

const hoist = (
  id: string,
  position: SceneObjectConfig["position"],
  parentId: string | null = null,
): SceneObjectConfig => ({
  id,
  shape: "cube",
  dimensions: { w: 1, h: 0.2, d: 1 },
  position,
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  kinematics: {
    controlType: "singlePointMove",
    runDirection: 1,
    pulleyDistance: 100,
    maxHeight: 3000,
    betaInit: 0,
  },
  parentId,
});

describe("mounted scene objects", () => {
  let engine: NullEngine;
  let scene: Scene;

  afterEach(() => {
    scene?.dispose();
    engine?.dispose();
  });

  const setup = () => {
    engine = new NullEngine();
    scene = new Scene(engine);
    const registry = new SceneObjectRegistry(scene, (config) => new SceneObject(config, scene, THEME_FALLBACK));
    // 大灯架在 6 m，小灯架挂在它下方 1 m、偏 0.5 m
    registry.sync([hoist("truss", { x: 1, y: 6, z: 0 }), hoist("lamp", { x: 0.5, y: -1, z: 0 }, "truss")]);
    return registry;
  };

  const worldOf = (registry: SceneObjectRegistry, id: string) => {
    const node = registry.get(id)!.attachmentPivot;
    node.computeWorldMatrix(true);
    return node.getAbsolutePosition();
  };

  it("adds the parent's live pose to the child's own relative pose", () => {
    const registry = setup();
    expect(worldOf(registry, "lamp").y).toBeCloseTo(5);

    const truss = registry.get("truss")!;
    truss.applyRuntimeTransform(resolveVirtualAxisTransform(truss.getConfig(), { v1: 2000 }));
    const lamp = registry.get("lamp")!;
    lamp.applyRuntimeTransform(resolveVirtualAxisTransform(lamp.getConfig(), { v1: 500 }));

    // 父物体下放 2 m，子物体相对自己的滑轮再下放 0.5 m
    const world = worldOf(registry, "lamp");
    expect(world.x).toBeCloseTo(1.5);
    expect(world.y).toBeCloseTo(2.5);
  });

  it("bakes a dragged child's world pose back as a parent-relative pose", () => {
    const registry = setup();
    const lampRoot = registry.get("lamp")!.object3d as TransformNode;
    const world = readWorldTransform(lampRoot);
    const local = applyWorldTransformUnderParent(lampRoot, {
      ...world,
      position: { x: world.position.x + 0.25, y: world.position.y, z: world.position.z },
    });
    expect(local.position.x).toBeCloseTo(0.75);
    expect(local.position.y).toBeCloseTo(-1);
    expect(lampRoot.parent).toBe(registry.get("truss")!.attachmentPivot);
  });

  it("stacks a child's GO shadow on the parent's GO shadow", () => {
    const registry = setup();
    const controller = new GoShadowController(
      scene,
      (id) => registry.get(id),
      THEME_FALLBACK,
      (id) => registry.getMountParent(id),
    );
    controller.set([
      { objectId: "truss", target: { v1: 2000 } },
      { objectId: "lamp", target: { v1: 500 } },
    ]);
    const lampShadow = scene.getTransformNodeByName("viz3d-go-shadow-lamp-pivot")!;
    lampShadow.computeWorldMatrix(true);
    expect(lampShadow.getAbsolutePosition().y).toBeCloseTo(2.5);

    // 父物体没有 GO 目标：子物体残影挂在父物体当前姿态下
    controller.set([{ objectId: "lamp", target: { v1: 500 } }]);
    const alone = scene.getTransformNodeByName("viz3d-go-shadow-lamp-pivot")!;
    alone.computeWorldMatrix(true);
    expect(alone.getAbsolutePosition().y).toBeCloseTo(4.5);
    controller.dispose();
  });

  it("draws a child's preview path on top of the parent's sampled poses", () => {
    const registry = setup();
    const controller = new SequencePreviewController(
      scene,
      (id) => registry.get(id),
      THEME_FALLBACK,
      (id) => registry.getMountParent(id),
    );
    controller.set({
      paths: [
        { objectId: "truss", poses: [{ v1: 0 }, { v1: 2000 }] },
        { objectId: "lamp", poses: [{ v1: 0 }, { v1: 0 }] },
      ],
    });
    const line = scene.meshes.find((mesh) => mesh.name === "viz3d-seq-preview-path-lamp")!;
    const positions = line.getVerticesData("position") ?? [];
    const ys = positions.filter((_, index) => index % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(5);
    expect(Math.min(...ys)).toBeCloseTo(3);
    controller.dispose();
  });
});
