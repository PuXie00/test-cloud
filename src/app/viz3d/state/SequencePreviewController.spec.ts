import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GreasedLineMesh } from "@babylonjs/core/Meshes/GreasedLine/greasedLineMesh";
import { GreasedLineSimpleMaterial } from "@babylonjs/core/Materials/GreasedLine/greasedLineSimpleMaterial";
import { afterEach, describe, expect, it } from "vitest";
import { THEME_FALLBACK } from "../engine/ThemeBridge";
import { SceneObject } from "../objects/SceneObject";
import { PREVIEW_PATH_LINE_WIDTH, SequencePreviewController } from "./SequencePreviewController";

describe("SequencePreviewController", () => {
  let engine: NullEngine;
  let scene: Scene;

  afterEach(() => {
    scene?.dispose();
    engine?.dispose();
  });

  it("draws an opaque screen-space path thicker than a hairline", () => {
    engine = new NullEngine();
    scene = new Scene(engine);
    const object = new SceneObject(
      {
        id: "co-path",
        shape: "cube",
        dimensions: { w: 1, h: 1, d: 1 },
        position: { x: 0, y: 0, z: 0 },
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
      },
      scene,
      THEME_FALLBACK,
    );
    const controller = new SequencePreviewController(
      scene,
      (id) => (id === object.id ? object : undefined),
      THEME_FALLBACK,
    );
    controller.set({
      paths: [{ objectId: object.id, poses: [{ v1: 0 }, { v1: 1000 }] }],
    });

    const mesh = scene.meshes.find((entry) => entry.name === "viz3d-seq-preview-path-co-path");
    expect(mesh).toBeInstanceOf(GreasedLineMesh);
    expect(mesh?.isPickable).toBe(false);
    expect(mesh?.renderingGroupId).toBe(1);
    expect(mesh?.material).toBeInstanceOf(GreasedLineSimpleMaterial);
    const material = mesh?.material as GreasedLineSimpleMaterial;
    expect(material.width).toBe(PREVIEW_PATH_LINE_WIDTH);
    expect(material.sizeAttenuation).toBe(true);
    expect(PREVIEW_PATH_LINE_WIDTH).toBeGreaterThan(3.5);
    controller.dispose();
  });
});
