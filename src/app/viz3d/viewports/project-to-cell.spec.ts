import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectWorldToCell } from "./project-to-cell";

describe("projectWorldToCell", () => {
  let babylon: NullEngine;
  let scene: Scene;

  beforeEach(() => {
    babylon = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1 });
    scene = new Scene(babylon);
  });

  afterEach(() => {
    scene.dispose();
    babylon.dispose();
  });

  it("相机目标点落在格子中心（画布坐标，含格子偏移）", () => {
    const camera = new ArcRotateCamera("c", 1, 1, 10, new Vector3(2, 0, 3), scene);
    // 右下格：GL 视口 y 自下而上
    camera.viewport = new Viewport(0.5, 0, 0.5, 0.5);
    scene.render();
    const cell = { left: 400, top: 300, width: 400, height: 300 };
    const projected = projectWorldToCell({ x: 2, y: 0, z: 3 }, camera, cell);
    expect(projected.x).toBeCloseTo(600);
    expect(projected.y).toBeCloseTo(450);
    expect(projected.visible).toBe(true);
  });

  it("相机背后的点不算在前方", () => {
    const camera = new ArcRotateCamera("c", 0, Math.PI / 2, 10, Vector3.Zero(), scene);
    scene.render();
    const behind = camera.position.scale(2);
    const projected = projectWorldToCell(behind, camera, { left: 0, top: 0, width: 800, height: 600 });
    expect(projected.inFront).toBe(false);
    expect(projected.visible).toBe(false);
  });
});
