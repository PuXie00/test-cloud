import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it } from "vitest";
import type { ControlType } from "@/app/project/configuration-types";
import type { SceneObjectConfig, VirtualAxisKinematics } from "../types";
import {
  angularRateOf,
  fitAngleToRange,
  plateNormalOf,
  pointRateOf,
  localTopCenter,
  parentUpOf,
  solveSwingTowards,
  type PoseKinematics,
} from "./pose-handle-kinematics";
import { angleBetween } from "./pose-handle-math";

const kinematics = (overrides: Partial<VirtualAxisKinematics> = {}): VirtualAxisKinematics => ({
  controlType: "singlePointMove",
  runDirection: 1,
  pulleyDistance: 100,
  maxHeight: 3000,
  betaInit: 0,
  ...overrides,
});

const objectOf = (controlType: ControlType, overrides: Partial<VirtualAxisKinematics> = {}): SceneObjectConfig => ({
  id: "co-1",
  shape: "cube",
  dimensions: { w: 2, h: 0.4, d: 1 },
  position: { x: 1, y: 5, z: -2 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0.3, z: 0 },
  color: "#869398",
  hoistAxes: [
    { key: "0", motorId: null, mount: { x: -0.8, z: -0.4 }, index: 0, motorDisplayIndex: null },
    { key: "1", motorId: null, mount: { x: 0.8, z: -0.4 }, index: 1, motorDisplayIndex: null },
    { key: "2", motorId: null, mount: { x: 0.8, z: 0.4 }, index: 2, motorDisplayIndex: null },
    { key: "3", motorId: null, mount: { x: -0.8, z: 0.4 }, index: 3, motorDisplayIndex: null },
  ],
  kinematics: kinematics({ controlType, ...overrides }),
});

const input = (
  config: SceneObjectConfig,
  values: Partial<PoseKinematics["values"]> = {},
  parentWorld: Matrix | null = null,
): PoseKinematics => ({ config, values: { v1: 0, v2: 0, v3: 0, ...values }, parentWorld });

const tiltedParent = (): Matrix =>
  Matrix.Compose(
    Vector3.One(),
    Quaternion.RotationYawPitchRoll(0.4, 0, 0.5),
    new Vector3(0, 8, 0),
  );

describe("pointRateOf", () => {
  it("follows the run direction for lift", () => {
    const forward = pointRateOf(input(objectOf("singlePointMove")), "v1", localTopCenter(objectOf("singlePointMove")));
    expect(forward.y).toBeCloseTo(-0.001, 7);
    const reverse = pointRateOf(
      input(objectOf("singlePointMove", { runDirection: 2 })),
      "v1",
      localTopCenter(objectOf("singlePointMove")),
    );
    expect(reverse.y).toBeCloseTo(0.001, 7);
  });

  it("lifts along the parent's up when mounted on a tilted object", () => {
    const parent = tiltedParent();
    const config = objectOf("singlePointMove", { runDirection: 2 });
    const rate = pointRateOf(input(config, {}, parent), "v1", localTopCenter(config));
    const up = parentUpOf(parent);
    expect(rate.x / 0.001).toBeCloseTo(up.x, 4);
    expect(rate.y / 0.001).toBeCloseTo(up.y, 4);
    expect(rate.z / 0.001).toBeCloseTo(up.z, 4);
  });
});

describe("angularRateOf", () => {
  it("turns one degree per unit about the vertical, flipped by run direction", () => {
    const forward = angularRateOf(input(objectOf("singlePointRotation"), { v1: 30 }), "v1")!;
    const reverse = angularRateOf(input(objectOf("singlePointRotation", { runDirection: 2 }), { v1: 30 }), "v1")!;
    expect(forward.rate).toBeCloseTo(Math.PI / 180, 6);
    expect(Math.abs(forward.axis.y)).toBeCloseTo(1, 6);
    expect(reverse.axis.y).toBeCloseTo(-forward.axis.y, 6);
  });

  it("gives the two four-point tilt axes, horizontal and perpendicular", () => {
    const config = objectOf("dualTiltFourPointSwing");
    const tiltX = angularRateOf(input(config), "v2")!;
    const tiltY = angularRateOf(input(config), "v3")!;
    expect(tiltX.rate).toBeCloseTo(Math.PI / 180, 6);
    expect(tiltY.rate).toBeCloseTo(Math.PI / 180, 6);
    expect(tiltX.axis.y).toBeCloseTo(0, 6);
    expect(tiltY.axis.y).toBeCloseTo(0, 6);
    expect(Math.abs(tiltX.axis.x * tiltY.axis.x + tiltX.axis.z * tiltY.axis.z)).toBeCloseTo(0, 6);
  });

  it("has no rotation for a pure lift", () => {
    expect(angularRateOf(input(objectOf("singlePointMove")), "v1")).toBeNull();
  });

  it("has no direction rate while a multi-point swing is level", () => {
    expect(angularRateOf(input(objectOf("multiPointSwing")), "v3")).toBeNull();
  });
});

describe("solveSwingTowards", () => {
  const cases: Array<{ name: string; overrides: Partial<VirtualAxisKinematics>; parent: Matrix | null }> = [
    { name: "plain", overrides: {}, parent: null },
    { name: "initial tilt direction", overrides: { betaInit: 35 }, parent: null },
    { name: "reverse run direction", overrides: { runDirection: 2, betaInit: -50 }, parent: null },
    { name: "mounted on a tilted parent", overrides: { betaInit: 20 }, parent: tiltedParent() },
  ];

  for (const { name, overrides, parent } of cases) {
    it(`reaches the target normal (${name})`, () => {
      const config = objectOf("multiPointSwing", overrides);
      const target = plateNormalOf(input(config, { v1: 300, v2: 14, v3: 127 }, parent));
      const solved = solveSwingTowards(input(config, { v1: 300, v2: 3, v3: -20 }, parent), target);
      const reached = plateNormalOf(input(config, { v1: 300, ...solved }, parent));
      expect(angleBetween(reached, target)).toBeLessThan(1e-4);
      expect(solved.v2).toBeCloseTo(14, 2);
    });
  }

  it("keeps the direction when the target is level", () => {
    const config = objectOf("multiPointSwing", { betaInit: 10 });
    const level = plateNormalOf(input(config, { v2: 0, v3: 0 }));
    expect(solveSwingTowards(input(config, { v2: 8, v3: 75 }), level)).toEqual({ v2: 0, v3: 75 });
  });

  it("keeps a negative tilt negative", () => {
    const config = objectOf("multiPointSwing");
    const target = plateNormalOf(input(config, { v2: -9, v3: 40 }));
    const solved = solveSwingTowards(input(config, { v2: -2, v3: 30 }), target);
    expect(solved.v2).toBeCloseTo(-9, 2);
    expect(solved.v3).toBeCloseTo(40, 2);
  });

  it("picks the direction turn closest to the start", () => {
    const config = objectOf("multiPointSwing");
    const target = plateNormalOf(input(config, { v2: 10, v3: 10 }));
    const solved = solveSwingTowards(input(config, { v2: 10, v3: 700 }), target);
    expect(solved.v3).toBeCloseTo(730, 2);
  });
});

describe("fitAngleToRange", () => {
  it("shifts by whole turns into the range", () => {
    expect(fitAngleToRange(370, { min: -180, max: 180 })).toBe(10);
    expect(fitAngleToRange(-200, { min: 0, max: 360 })).toBe(160);
    expect(fitAngleToRange(50, { min: 0, max: 360 })).toBe(50);
    expect(fitAngleToRange(50, { min: 60, max: 70 })).toBe(50);
  });
});
