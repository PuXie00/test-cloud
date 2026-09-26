import { describe, expect, it } from "vitest";
import type { SceneObjectConfig, VirtualAxisKinematics } from "../types";
import { previewPathPoints } from "./preview-path-points";

const kinematics = (overrides: Partial<VirtualAxisKinematics> = {}): VirtualAxisKinematics => ({
  controlType: "singlePointMove",
  runDirection: 1,
  pulleyDistance: 100,
  maxHeight: 3000,
  betaInit: 0,
  ...overrides,
});

const base: SceneObjectConfig = {
  id: "co-path",
  shape: "cube",
  dimensions: { w: 2, h: 1, d: 1 },
  position: { x: 1, y: 2, z: 3 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  kinematics: kinematics(),
};

describe("previewPathPoints", () => {
  it("lowers with v1 (mm → m) for run direction 1", () => {
    const points = previewPathPoints(base, [{ v1: 0 }, { v1: 1000 }]);
    expect(points[0]!.y).toBeCloseTo(2);
    expect(points[1]!.y).toBeCloseTo(1);
  });

  it("raises with v1 for run direction 2", () => {
    const points = previewPathPoints({ ...base, kinematics: kinematics({ runDirection: 2 }) }, [{ v1: 1000 }]);
    expect(points[0]!.y).toBeCloseTo(3);
  });

  it("tracks the object center when swinging about the hoist plane", () => {
    const config: SceneObjectConfig = {
      ...base,
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      hoistAxes: [
        { key: "0", motorId: null, mount: { x: -0.7, z: 0 }, index: 0, motorDisplayIndex: null },
        { key: "1", motorId: null, mount: { x: 0.7, z: 0 }, index: 1, motorDisplayIndex: null },
      ],
      kinematics: kinematics({ controlType: "twoPointSwing" }),
    };
    const [rest, swung] = previewPathPoints(config, [{ v1: 0 }, { v1: 0, v2: 90 }]);
    expect(rest).toEqual({ x: 1, y: 2, z: 3 });
    expect(swung!.y).toBeCloseTo(2.5, 6);
    expect(Math.hypot(swung!.x - 1, swung!.z - 3)).toBeCloseTo(0.5 + 0.7, 6);
  });
});
