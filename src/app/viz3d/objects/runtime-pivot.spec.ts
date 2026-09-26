import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { THEME_FALLBACK } from "../engine/ThemeBridge";
import { resolveVirtualAxisTransform } from "../telemetry/virtual-axis-mapper";
import type { SceneObjectConfig } from "../types";
import { SceneObject } from "./SceneObject";

const MOUNTS = [
  { x: 0.5, z: 0 },
  { x: -0.25, z: 0.43 },
  { x: -0.25, z: -0.43 },
];

const config: SceneObjectConfig = {
  id: "co-pivot",
  shape: "cube",
  dimensions: { w: 1.2, h: 0.4, d: 1.2 },
  position: { x: 2, y: 5, z: -1 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  hoistAxes: MOUNTS.map((mount, index) => ({
    key: String(index),
    motorId: null,
    mount,
    index,
    motorDisplayIndex: null,
  })),
  kinematics: {
    controlType: "multiPointSwing",
    runDirection: 1,
    pulleyDistance: 100,
    maxHeight: 3000,
    betaInit: 30,
  },
};

describe("applyRuntimeTransform", () => {
  let engine: NullEngine;
  let scene: Scene;

  afterEach(() => {
    scene?.dispose();
    engine?.dispose();
  });

  it("places hoist points where the virtual-axis kinematics put them", () => {
    engine = new NullEngine();
    scene = new Scene(engine);
    const object = new SceneObject(config, scene, THEME_FALLBACK);
    const transform = resolveVirtualAxisTransform(config, { v1: 400, v2: 12, v3: 50 });
    object.applyRuntimeTransform(transform);

    const q = transform.rotationQuaternion!;
    const pivot = transform.pivotPosition!;
    for (const mount of MOUNTS) {
      const local = new Vector3(mount.x, config.dimensions.h / 2, mount.z);
      const hoist = new TransformNode("hoist-marker", scene);
      hoist.parent = object.attachmentPivot;
      hoist.position.copyFrom(local);
      hoist.computeWorldMatrix(true);
      const t = new Vector3(q.x, q.y, q.z).cross(local).scale(2);
      const rotated = local
        .add(t.scale(q.w))
        .add(new Vector3(q.x, q.y, q.z).cross(t));
      const expected = rotated
        .add(new Vector3(pivot.x, pivot.y, pivot.z))
        .add(new Vector3(transform.position.x, transform.position.y, transform.position.z));
      const actual = hoist.getAbsolutePosition();
      expect(actual.x).toBeCloseTo(expected.x, 6);
      expect(actual.y).toBeCloseTo(expected.y, 6);
      expect(actual.z).toBeCloseTo(expected.z, 6);
    }
  });

  it("resets the runtime pivot when config is re-applied", () => {
    engine = new NullEngine();
    scene = new Scene(engine);
    const object = new SceneObject(config, scene, THEME_FALLBACK);
    object.applyRuntimeTransform(resolveVirtualAxisTransform(config, { v1: 0, v2: 10, v3: 0 }));
    object.applyConfig({ ...config });
    expect(object.runtimePivot.rotationQuaternion).toBeNull();
    expect(object.runtimePivot.position.asArray()).toEqual([0, 0, 0]);
  });
});
