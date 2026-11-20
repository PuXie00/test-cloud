// @vitest-environment jsdom
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { THEME_FALLBACK } from "../engine/ThemeBridge";
import type { SceneObjectConfig } from "../types";
import { SceneObject } from "./SceneObject";

const disposers: (() => void)[] = [];

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});

const objectOf = (overrides: Partial<SceneObjectConfig>): SceneObject => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const object = new SceneObject(
    {
      id: "label-anchor",
      shape: "cube",
      dimensions: { w: 4, h: 1, d: 2 },
      position: { x: 3, y: 4, z: 5 },
      centerOffset: { x: 0, y: 0.25, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      color: "#869398",
      ...overrides,
    },
    scene,
    THEME_FALLBACK,
  );
  disposers.push(() => {
    object.dispose();
    scene.dispose();
    engine.dispose();
  });
  return object;
};

const hoist = (index: number, x: number, z: number) => ({
  key: `axis-${index}`,
  motorId: null,
  mount: { x, z },
  index,
  motorDisplayIndex: null,
});

const rounded = ({ x, y, z }: { x: number; y: number; z: number }) => ({
  x: Math.round(x * 1e9) / 1e9,
  y: Math.round(y * 1e9) / 1e9,
  z: Math.round(z * 1e9) / 1e9,
});

describe("SceneObject.getLabelAnchorWorldPosition", () => {
  it("sits on the first hoist point on the top face", () => {
    const object = objectOf({ hoistAxes: [hoist(0, -1.5, 0.5), hoist(1, 1.5, -0.5)] });
    // 第一个吊点 (-1.5, 0.5)，顶面 y = h/2 = 0.5，再加物体位置
    expect(rounded(object.getLabelAnchorWorldPosition())).toEqual({ x: 1.5, y: 4.5, z: 5.5 });
  });

  it("follows the object rotation", () => {
    const object = objectOf({
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      hoistAxes: [hoist(0, 1, 0)],
    });
    // 绕 Y 转 90°：局部 +X 指向世界 -Z
    expect(rounded(object.getLabelAnchorWorldPosition())).toEqual({ x: 3, y: 4.5, z: 4 });
  });

  it("keeps the anchor when the hoist points are hidden", () => {
    const object = objectOf({ showHoistPoints: false, hoistAxes: [hoist(0, -1.5, 0.5)] });
    expect(rounded(object.getLabelAnchorWorldPosition())).toEqual({ x: 1.5, y: 4.5, z: 5.5 });
  });

  it("falls back to the transform center without hoist points", () => {
    const object = objectOf({ hoistAxes: [] });
    expect(object.getLabelAnchorWorldPosition()).toEqual(object.getTransformCenterWorldPosition());
    expect(rounded(object.getLabelAnchorWorldPosition())).toEqual({ x: 3, y: 4.25, z: 5 });
  });
});
