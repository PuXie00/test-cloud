import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hexToColor3 } from "../babylon/utils";
import { resolveHoistTravel } from "../telemetry/hoist-travel";

const { labels } = vi.hoisted(() => ({ labels: [] as { offsetY: number }[] }));

// 标签要 2D canvas 画字，测试环境没有：换成只记位置的假标签
vi.mock("./HoistPointLabel", async () => {
  const { TransformNode: Node } = await import("@babylonjs/core/Meshes/transformNode");
  return {
    HoistPointLabel: class {
      readonly plane: InstanceType<typeof Node>;
      offsetY = 0;
      constructor(scene: Scene) {
        this.plane = new Node("fake-label", scene);
        labels.push(this);
      }
      setText() {}
      setAppearance() {}
      setSpriteSize() {}
      setOffsetY(y: number) {
        this.offsetY = y;
      }
      dispose() {
        this.plane.dispose();
      }
    },
  };
});

import { HoistPointVisual } from "./HoistPointVisual";

const SCALE = 0.2;

describe("HoistPointVisual", () => {
  let engine: NullEngine;
  let scene: Scene;
  let visual: HoistPointVisual;

  const mesh = (name: string) => scene.getMeshByName(name)!;
  const colorOf = (name: string) => (mesh(name).material as StandardMaterial).diffuseColor;
  const label = () => labels[labels.length - 1]!;

  beforeEach(() => {
    labels.length = 0;
    engine = new NullEngine();
    scene = new Scene(engine);
    visual = new HoistPointVisual(scene, SCALE);
    visual.root.parent = new TransformNode("object", scene);
  });

  afterEach(() => {
    visual.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("is a dark base with a stem and an upright lifting eye, scaled as a whole", () => {
    expect(visual.geometryRoot.scaling.asArray()).toEqual([SCALE, SCALE, SCALE]);
    expect(mesh("viz3d-hoist-eye").rotation.x).toBeCloseTo(Math.PI / 2);
    expect(colorOf("viz3d-hoist-base").equals(hexToColor3(0x262d30))).toBe(true);
    for (const name of ["viz3d-hoist-base", "viz3d-hoist-stem", "viz3d-hoist-eye"]) {
      expect(mesh(name).isPickable).toBe(true);
      expect(mesh(name).parent).toBe(visual.geometryRoot);
    }
  });

  it("colors the eye by binding: primary when bound, light gray when not", () => {
    expect(colorOf("viz3d-hoist-eye").equals(hexToColor3(0xc4ccd0))).toBe(true);
    visual.setBound(true, false);
    expect(colorOf("viz3d-hoist-eye").equals(hexToColor3(0x4cd6fb))).toBe(true);
    expect(colorOf("viz3d-hoist-stem")).toBe(colorOf("viz3d-hoist-eye"));
  });

  it("draws the live position in green, apart from the hoist's own color", () => {
    visual.setBound(true, false);
    visual.setTravel(resolveHoistTravel("linear", 300, "forward"));
    const live = colorOf("viz3d-hoist-live-ring");
    expect(live.equals(hexToColor3(0x4ade80))).toBe(true);
    expect(live.equals(colorOf("viz3d-hoist-eye"))).toBe(false);
    expect(mesh("viz3d-hoist-live-ring").renderOutline).toBe(true);
  });

  it("runs a line down to a ring at the live position and leaves the label above the hoist", () => {
    const restY = label().offsetY;
    visual.setTravel({ kind: "linear", lift: -0.3 });
    expect(mesh("viz3d-hoist-live-line").isEnabled()).toBe(true);
    expect(mesh("viz3d-hoist-live-line").scaling.y).toBeCloseTo(0.3);
    expect(mesh("viz3d-hoist-live-line").position.y).toBeCloseTo(-0.15);
    expect(mesh("viz3d-hoist-live-ring").getAbsolutePosition().y).toBeCloseTo(-0.3);
    expect(label().offsetY).toBe(restY);
  });

  it("lifts the label above the ring when the live position is higher than the label", () => {
    const restY = label().offsetY;
    visual.setTravel({ kind: "linear", lift: 0.05 });
    expect(label().offsetY).toBe(restY);
    visual.setTravel({ kind: "linear", lift: 0.6 });
    expect(label().offsetY).toBeCloseTo(0.6 + 0.75 * SCALE);
    visual.setTravel(null);
    expect(label().offsetY).toBe(restY);
  });

  it("shows the dial instead of the line for an endless rotation axis", () => {
    visual.setTravel(resolveHoistTravel("rotary", 90, "forward"));
    expect(mesh("viz3d-hoist-dial-ring").isEnabled()).toBe(true);
    expect(mesh("viz3d-hoist-live-line").isEnabled()).toBe(false);
    expect(colorOf("viz3d-hoist-dial-needle").equals(hexToColor3(0x4ade80))).toBe(true);
  });

  it("puts the whole hoist on top while debugging and back afterwards", () => {
    visual.setTravel({ kind: "linear", lift: 0.2 });
    expect(mesh("viz3d-hoist-eye").renderingGroupId).toBe(1);
    expect(mesh("viz3d-hoist-live-ring").renderingGroupId).toBe(1);
    visual.setTravel(null);
    expect(mesh("viz3d-hoist-eye").renderingGroupId).toBe(0);
    expect(mesh("viz3d-hoist-live-line").isEnabled()).toBe(false);
    expect(mesh("viz3d-hoist-dial-ring").isEnabled()).toBe(false);
  });

  it("keeps the live marker and dial out of picking", () => {
    for (const name of ["viz3d-hoist-live-line", "viz3d-hoist-live-ring", "viz3d-hoist-dial-ring"]) {
      expect(mesh(name).isPickable).toBe(false);
    }
  });

  it("releases every mesh and material", () => {
    const meshesBefore = scene.meshes.length;
    const materialsBefore = scene.materials.length;
    visual.dispose();
    expect(scene.meshes.length).toBeLessThan(meshesBefore);
    expect(scene.getMeshByName("viz3d-hoist-eye")).toBeNull();
    expect(scene.materials.length).toBe(materialsBefore - 4);
    // afterEach 再释放一次也不报错
  });
});
