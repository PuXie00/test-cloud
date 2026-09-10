import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEME_FALLBACK } from "../engine/ThemeBridge";
import type { SceneObjectConfig } from "../types";
import { SceneObject } from "./SceneObject";
import { applyVisibility, DIMMED_VISIBILITY } from "./scene-object-dim";

const stubCanvasContext = () => ({
  clearRect() {},
  fillRect() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  quadraticCurveTo() {},
  closePath() {},
  fill() {},
  stroke() {},
  fillText() {},
  measureText: () => ({ width: 10 }),
  save() {},
  restore() {},
  scale() {},
  font: "",
  fillStyle: "",
  strokeStyle: "",
  textAlign: "",
  textBaseline: "",
  lineWidth: 1,
});

const installCanvasStub = (): (() => void) => {
  const g = globalThis as typeof globalThis & {
    HTMLCanvasElement?: { new (): { getContext: () => unknown }; prototype: { getContext: unknown } };
    document?: {
      createElement: (tag: string) => unknown;
      addEventListener?: (...args: unknown[]) => void;
      removeEventListener?: (...args: unknown[]) => void;
    };
  };

  if (typeof g.HTMLCanvasElement !== "undefined") {
    const original = g.HTMLCanvasElement.prototype.getContext;
    g.HTMLCanvasElement.prototype.getContext = (() => stubCanvasContext()) as typeof original;
    return () => {
      g.HTMLCanvasElement!.prototype.getContext = original;
    };
  }

  class HTMLCanvasElementStub {
    width = 64;
    height = 64;
    getContext() {
      return stubCanvasContext();
    }
  }

  g.HTMLCanvasElement = HTMLCanvasElementStub as typeof g.HTMLCanvasElement;
  const originalDocument = g.document;
  const noop = () => {};
  g.document = {
    createElement: (tag: string) => {
      if (tag === "canvas") return new HTMLCanvasElementStub();
      return originalDocument?.createElement?.(tag) ?? {};
    },
    addEventListener: originalDocument?.addEventListener ?? noop,
    removeEventListener: originalDocument?.removeEventListener ?? noop,
  } as Document;

  return () => {
    delete g.HTMLCanvasElement;
    if (originalDocument) g.document = originalDocument;
    else delete (g as { document?: unknown }).document;
  };
};

const baseConfig: SceneObjectConfig = {
  id: "co-dim",
  shape: "cube",
  dimensions: { w: 2, h: 1, d: 1 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
};

const visibilities = (root: TransformNode): number[] =>
  root.getChildMeshes(false).map((mesh) => mesh.visibility);

describe("applyVisibility", () => {
  let engine: NullEngine;
  let scene: Scene;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
  });
  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  it("writes visibility to every descendant mesh", () => {
    const root = new TransformNode("root", scene);
    const child = new TransformNode("child", scene);
    child.parent = root;
    const a = MeshBuilder.CreateBox("a", { size: 1 }, scene);
    const b = MeshBuilder.CreateBox("b", { size: 1 }, scene);
    a.parent = root;
    b.parent = child;

    applyVisibility(root, DIMMED_VISIBILITY);
    expect(visibilities(root)).toEqual([DIMMED_VISIBILITY, DIMMED_VISIBILITY]);

    applyVisibility(root, 1);
    expect(visibilities(root)).toEqual([1, 1]);
  });
});

describe("SceneObject.setDimmed", () => {
  let engine: NullEngine;
  let scene: Scene;
  let restoreCanvas: () => void;

  beforeEach(() => {
    restoreCanvas = installCanvasStub();
    engine = new NullEngine();
    scene = new Scene(engine);
  });
  afterEach(() => {
    scene.dispose();
    engine.dispose();
    restoreCanvas();
  });

  it("dims body and front marker, then restores", () => {
    const object = new SceneObject(baseConfig, scene, THEME_FALLBACK);
    expect(visibilities(object.getVisualRoot()).every((v) => v === 1)).toBe(true);

    object.setDimmed(true);
    const dimmed = visibilities(object.getVisualRoot());
    expect(dimmed.length).toBeGreaterThan(0);
    expect(dimmed.every((v) => v === DIMMED_VISIBILITY)).toBe(true);

    object.setDimmed(false);
    expect(visibilities(object.getVisualRoot()).every((v) => v === 1)).toBe(true);
  });

  it("keeps dim state after preset shape change", () => {
    const object = new SceneObject(baseConfig, scene, THEME_FALLBACK);
    object.setDimmed(true);
    object.applyConfig({ ...baseConfig, shape: "cyl" });
    expect(visibilities(object.getVisualRoot()).every((v) => v === DIMMED_VISIBILITY)).toBe(true);
  });

  it("keeps dim state after visual rebuild (model id change without template)", () => {
    const object = new SceneObject(baseConfig, scene, THEME_FALLBACK);
    object.setDimmed(true);
    object.applyConfig({ ...baseConfig, model: { id: "missing-model" } });
    expect(visibilities(object.getVisualRoot()).every((v) => v === DIMMED_VISIBILITY)).toBe(true);
  });

  it("dims hoist point geometry and label", () => {
    const object = new SceneObject(
      {
        ...baseConfig,
        showHoistPoints: true,
        hoistAxes: [{ key: "a1", motorId: null, mount: { x: 0, z: 0 }, index: 0, motorDisplayIndex: null }],
      },
      scene,
      THEME_FALLBACK,
    );
    object.setDimmed(true);
    const hoistRoot = object.runtimePivot
      .getChildTransformNodes(true)
      .find((node) => node.name === "viz3d-hoist-point");
    expect(hoistRoot).toBeDefined();
    expect(visibilities(hoistRoot!).every((v) => v === DIMMED_VISIBILITY)).toBe(true);
  });
});
