import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { THEME_FALLBACK } from "../engine/ThemeBridge";
import { SceneObject } from "../objects/SceneObject";
import { DIMMED_VISIBILITY } from "../objects/scene-object-dim";
import { GoShadow } from "./GoShadow";

describe("GoShadow", () => {
  let engine: NullEngine;
  let scene: Scene;

  afterEach(() => {
    scene?.dispose();
    engine?.dispose();
  });

  it("clones a dimmed object at full visibility", () => {
    engine = new NullEngine();
    scene = new Scene(engine);
    const object = new SceneObject(
      {
        id: "co-shadow",
        shape: "cube",
        dimensions: { w: 1, h: 1, d: 1 },
        position: { x: 0, y: 0, z: 0 },
        centerOffset: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: "#869398",
        virtualAxes: [{ axis: "v1", kind: "move" }],
      },
      scene,
      THEME_FALLBACK,
    );
    object.setDimmed(true);
    expect(object.getVisualRoot().getChildMeshes(false)[0]?.visibility).toBe(DIMMED_VISIBILITY);

    const shadow = new GoShadow(object, { v1: 1000 }, scene, THEME_FALLBACK);
    const shadowMeshes = scene.meshes.filter((mesh) =>
      mesh.name.startsWith("viz3d-go-shadow-co-shadow-visual"),
    );
    expect(shadowMeshes.length).toBeGreaterThan(0);
    expect(shadowMeshes.every((mesh) => mesh.visibility === 1)).toBe(true);
    shadow.dispose();
  });
});
