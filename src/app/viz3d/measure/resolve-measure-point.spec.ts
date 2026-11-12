import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setNodeMetadata } from "../babylon/utils";
import type { Vec3 } from "../types";
import { projectWorldToCell } from "../viewports/project-to-cell";
import { projectRulerToCell } from "./project-ruler";
import { resolveMeasurePoint, type MeasurePickContext } from "./resolve-measure-point";

const CELL = { left: 0, top: 0, width: 800, height: 600 };
const FINE = { snapVertices: false, coarse: false };

describe("measure picking", () => {
  let babylon: NullEngine;
  let scene: Scene;
  let camera: ArcRotateCamera;
  let objectRoot: TransformNode;

  beforeEach(() => {
    babylon = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1 });
    scene = new Scene(babylon);
    camera = new ArcRotateCamera("c", -Math.PI / 2, 0.8, 12, Vector3.Zero(), scene);
    camera.minZ = 0.1;
    camera.maxZ = 200;
    objectRoot = new TransformNode("object", scene);
    // 2m 立方体：顶面 y=1
    // 没有材质的网格 Babylon 只做包围盒拾取（没有落点）；场景里的物体都有材质
    const box = MeshBuilder.CreateBox("box", { size: 2 }, scene);
    box.material = new StandardMaterial("m", scene);
    box.parent = objectRoot;
    scene.render();
  });

  afterEach(() => {
    scene.dispose();
    babylon.dispose();
  });

  const screenOf = (point: Vec3) => projectWorldToCell(point, camera, CELL);
  const context = (hoistAnchors: Vec3[] = []): MeasurePickContext => ({
    camera,
    cellRect: CELL,
    targets: [objectRoot],
    hoistAnchors,
  });
  const resolveAt = (point: Vec3, dx = 0, dy = 0, options = FINE, hoistAnchors: Vec3[] = []) => {
    const screen = screenOf(point);
    return resolveMeasurePoint(screen.x + dx, screen.y + dy, context(hoistAnchors), options);
  };

  it("lands on the object surface under the cursor", () => {
    const result = resolveAt({ x: 0.3, y: 1, z: 0.2 });
    expect(result?.snap).toBe("surface");
    expect(result?.point.y).toBeCloseTo(1, 4);
    expect(result?.point.x).toBeCloseTo(0.3, 3);
  });

  it("snaps to the nearest vertex only when vertex snapping is on", () => {
    const corner = { x: 1, y: 1, z: -1 };
    expect(resolveAt(corner, -6, -4)?.snap).toBe("surface");
    const snapped = resolveAt(corner, -6, -4, { snapVertices: true, coarse: false });
    expect(snapped).toMatchObject({ snap: "vertex" });
    expect(snapped!.point.x).toBeCloseTo(1, 6);
    expect(snapped!.point.y).toBeCloseTo(1, 6);
    expect(snapped!.point.z).toBeCloseTo(-1, 6);
  });

  it("snaps to a visible hoist center near the cursor, but not one hidden behind the object", () => {
    const top = { x: 0.5, y: 1, z: 0 };
    expect(resolveAt({ x: 0.45, y: 1, z: 0 }, 0, 0, FINE, [top])).toEqual({ point: top, snap: "hoist" });
    // 立方体底面中心被立方体挡住
    const bottom = { x: 0, y: -1, z: 0 };
    const screen = screenOf(bottom);
    expect(resolveMeasurePoint(screen.x, screen.y, context([bottom]), FINE)?.snap).toBe("surface");
  });

  it("returns the hoist root when the cursor hits hoist geometry", () => {
    const hoist = new TransformNode("hoist", scene);
    hoist.parent = objectRoot;
    hoist.position.set(-0.6, 1.2, 0);
    setNodeMetadata(hoist, "viz3dAxisKey", "0");
    const eye = MeshBuilder.CreateSphere("eye", { diameter: 0.6 }, scene);
    eye.parent = hoist;
    eye.material = new StandardMaterial("eye-m", scene);
    eye.position.y = 0.3;
    scene.render();
    const result = resolveAt({ x: -0.6, y: 1.8, z: 0 });
    expect(result?.snap).toBe("hoist");
    expect(result?.point.x).toBeCloseTo(-0.6, 6);
    expect(result?.point.y).toBeCloseTo(1.2, 6);
  });

  it("falls back to the ground, then to the view plane through the camera target", () => {
    const ground = resolveAt({ x: 4, y: 0, z: 3 });
    expect(ground?.snap).toBe("ground");
    expect(ground?.point.y).toBeCloseTo(0, 6);
    expect(ground?.point.x).toBeCloseTo(4, 3);

    // 平视：射线和地面平行，落到过目标点、垂直视线的平面上
    camera.beta = Math.PI / 2;
    camera.target.set(0, 3, 5);
    scene.render();
    const view = resolveAt({ x: 2, y: 3, z: 5 });
    expect(view?.snap).toBe("view");
    expect(view?.point.z).toBeCloseTo(5, 4);
    expect(view?.point.x).toBeCloseTo(2, 3);
  });

  describe("projectRulerToCell", () => {
    it("projects both ends when the ruler is in front", () => {
      const ruler = { id: "r", a: { x: -1, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } };
      const projected = projectRulerToCell(ruler, camera, CELL);
      expect(projected).toMatchObject({ aInFront: true, bInFront: true });
      expect(projected!.a.x).toBeCloseTo(screenOf(ruler.a).x, 6);
      expect(projected!.b.y).toBeCloseTo(screenOf(ruler.b).y, 6);
    });

    it("clips the part behind the camera and drops a ruler fully behind it", () => {
      const behind = camera.position.add(camera.position.subtract(camera.target).normalize().scale(3));
      const behindPoint = { x: behind.x, y: behind.y, z: behind.z };
      const projected = projectRulerToCell({ id: "r", a: behindPoint, b: { x: 0, y: 0, z: 0 } }, camera, CELL);
      expect(projected).toMatchObject({ aInFront: false, bInFront: true });
      expect(Number.isFinite(projected!.a.x) && Number.isFinite(projected!.a.y)).toBe(true);
      const further = camera.position.add(camera.position.subtract(camera.target).normalize().scale(5));
      expect(
        projectRulerToCell({ id: "r", a: behindPoint, b: { x: further.x, y: further.y, z: further.z } }, camera, CELL),
      ).toBeNull();
    });
  });
});
