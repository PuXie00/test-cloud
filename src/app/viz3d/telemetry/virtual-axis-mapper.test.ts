import { describe, expect, it } from "vitest";
import { solveMultiPointForward } from "@/app/kinematics/multi-point-forward";
import type { ControlType } from "@/app/project/configuration-types";
import { resolveVirtualAxisTransform } from "./virtual-axis-mapper";
import type { Quat, RuntimeTransform, SceneObjectConfig, Vec3, VirtualAxisValues } from "../types";

const DEG = Math.PI / 180;
const PULLEY_MM = 100;
const MAX_HEIGHT_MM = 3000;

type Mount = { x: number; z: number };

const configOf = (
  controlType: ControlType,
  mountsMm: readonly Mount[],
  runDirection: 1 | 2 = 1,
  betaInit = 0,
): SceneObjectConfig => ({
  id: "co-1",
  shape: "cube",
  dimensions: { w: 2, h: 0.6, d: 1 },
  position: { x: 10, y: 4, z: -2 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#4cd6fb",
  hoistAxes: mountsMm.map((mount, index) => ({
    key: String(index),
    motorId: null,
    mount: { x: mount.x / 1000, z: mount.z / 1000 },
    index,
    motorDisplayIndex: null,
  })),
  kinematics: {
    controlType,
    runDirection,
    pulleyDistance: PULLEY_MM,
    maxHeight: MAX_HEIGHT_MM,
    betaInit,
  },
});

const rotateByQuat = (q: Quat, v: Vec3): Vec3 => {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
};

/** 运动枢轴局部点 → 世界（物体根无朝向旋转） */
const toWorld = (config: SceneObjectConfig, transform: RuntimeTransform, local: Vec3): Vec3 => {
  const rotated = rotateByQuat(transform.rotationQuaternion!, local);
  const pivot = transform.pivotPosition!;
  return {
    x: transform.position.x + pivot.x + rotated.x,
    y: transform.position.y + pivot.y + rotated.y,
    z: transform.position.z + pivot.z + rotated.z,
  };
};

const hoistLocal = (config: SceneObjectConfig, mount: { x: number; z: number }): Vec3 => ({
  x: mount.x,
  y: config.dimensions.h / 2,
  z: mount.z,
});

const distanceMm = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 1000;

/** 由 3D 吊点世界坐标反推 PLC 绳长：方向 1 滑轮在初始吊点上方 BaseHeight1，方向 2 在 BaseHeight2 + maxheight */
const ropeLengthsFrom3D = (config: SceneObjectConfig, values: VirtualAxisValues): number[] => {
  const transform = resolveVirtualAxisTransform(config, values);
  const direction = config.kinematics!.runDirection;
  const anchorRise = direction === 2 ? PULLEY_MM + MAX_HEIGHT_MM : PULLEY_MM;
  return (config.hoistAxes ?? []).map((axis) => {
    const local = hoistLocal(config, axis.mount);
    const anchor = {
      x: config.position.x + local.x,
      y: config.position.y + local.y + anchorRise / 1000,
      z: config.position.z + local.z,
    };
    const distance = distanceMm(anchor, toWorld(config, transform, local));
    return direction === 2 ? anchorRise - distance : distance - PULLEY_MM;
  });
};

/** YXZ liangdian_forward_model(arg_x, height, BaseHight1, BaseHight2, lLenth_inside, maxheight) */
const liangdianForward = (argX: number, height: number, direction: 1 | 2, length: number): [number, number] => {
  const half = length / 2;
  if (direction === 1) {
    const offset = (argX / 90) ** 3 * half;
    const rad = argX * DEG;
    const xA = -Math.cos(rad) * half - offset;
    const xB = Math.cos(rad) * half - offset;
    const yA = height - Math.sin(rad) * half + PULLEY_MM;
    const yB = height + Math.sin(rad) * half + PULLEY_MM;
    return [Math.hypot(xA + half, yA) - PULLEY_MM, Math.hypot(xB - half, yB) - PULLEY_MM];
  }
  const flipped = -argX;
  const offset = (flipped / 90) ** 3 * half;
  const rad = flipped * DEG;
  const top = PULLEY_MM + MAX_HEIGHT_MM;
  const xA = -Math.cos(rad) * half - offset;
  const xB = Math.cos(rad) * half - offset;
  const yA = height - Math.sin(rad) * half;
  const yB = height + Math.sin(rad) * half;
  return [top - Math.hypot(xA + half, yA - top), top - Math.hypot(xB - half, yB - top)];
};

/** YXZ sidian_forward_model：moveWhat 1 摆 X（A=D, B=C），moveWhat 2 摆 Y（A=B 取正端, C=D） */
const sidianForward = (
  argX: number,
  argY: number,
  height: number,
  direction: 1 | 2,
  lengthX: number,
  lengthZ: number,
): number[] => {
  if (argY === 0) {
    const [a, b] = liangdianForward(argX, height, direction, lengthX);
    return [a, b, b, a];
  }
  const [negative, positive] = liangdianForward(argY, height, direction, lengthZ);
  return [positive, positive, negative, negative];
};

const expectLengths = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 6));
};

const TWO_POINT: Mount[] = [
  { x: -700, z: 0 },
  { x: 700, z: 0 },
];
const FOUR_POINT: Mount[] = [
  { x: -600, z: -300 },
  { x: 600, z: -300 },
  { x: 600, z: 300 },
  { x: -600, z: 300 },
];
const MULTI_POINT: Mount[] = [
  { x: 500, z: 0 },
  { x: 150, z: 480 },
  { x: -400, z: 300 },
  { x: -400, z: -300 },
  { x: 150, z: -480 },
];

describe("resolveVirtualAxisTransform", () => {
  it("no kinematics leaves the object at its configured pose", () => {
    const config = { ...configOf("singlePointMove", []), kinematics: undefined };
    const t = resolveVirtualAxisTransform(config, { v1: 999 });
    expect(t.position).toEqual(config.position);
    expect(t.pivotPosition).toEqual({ x: 0, y: 0, z: 0 });
    expect(t.rotationQuaternion).toEqual({ w: 1, x: 0, y: 0, z: 0 });
  });

  it("lift: direction 1 lowers with v1, direction 2 raises", () => {
    const down = resolveVirtualAxisTransform(configOf("singlePointMove", [{ x: 0, z: 0 }]), { v1: 1500 });
    expect(down.position).toEqual({ x: 10, y: 2.5, z: -2 });
    const up = resolveVirtualAxisTransform(configOf("multiLevelHoist", [{ x: 0, z: 0 }], 2), { v1: 1500 });
    expect(up.position.y).toBeCloseTo(5.5, 9);
  });

  it("rotation: clockwise seen from above (+x → −z), reversed by direction 2", () => {
    const forward = resolveVirtualAxisTransform(configOf("singlePointRotation", [{ x: 0, z: 0 }]), { v1: 90 });
    const east = rotateByQuat(forward.rotationQuaternion!, { x: 1, y: 0, z: 0 });
    expect(east.x).toBeCloseTo(0, 9);
    expect(east.z).toBeCloseTo(-1, 9);
    expect(forward.position.y).toBe(4);

    const reverse = resolveVirtualAxisTransform(configOf("continuousRotation", [{ x: 0, z: 0 }], 2), { v1: 90 });
    expect(rotateByQuat(reverse.rotationQuaternion!, { x: 1, y: 0, z: 0 }).z).toBeCloseTo(1, 9);
  });

  it("two-point swing: v2 > 0 raises the −x end, rotating about the hoist plane", () => {
    const config = configOf("twoPointSwing", TWO_POINT);
    const t = resolveVirtualAxisTransform(config, { v1: 0, v2: 10 });
    const [a, b] = config.hoistAxes!;
    expect(toWorld(config, t, hoistLocal(config, a!.mount)).y).toBeGreaterThan(4.3);
    expect(toWorld(config, t, hoistLocal(config, b!.mount)).y).toBeLessThan(4.3);
  });

  it.each([1, 2] as const)("two-point swing matches PLC rope lengths (direction %i)", (direction) => {
    for (const [v1, v2] of [
      [0, 0],
      [800, 0],
      [800, 15],
      [1200, -20],
    ] as const) {
      const config = configOf("twoPointSwing", TWO_POINT, direction);
      expectLengths(ropeLengthsFrom3D(config, { v1, v2 }), liangdianForward(v2, v1, direction, 1400));
    }
  });

  it("two-point swing follows the actual mount direction", () => {
    const diagonal: Mount[] = [
      { x: -300, z: -400 },
      { x: 300, z: 400 },
    ];
    const config = configOf("twoPointSwing", diagonal);
    expectLengths(ropeLengthsFrom3D(config, { v1: 500, v2: 12 }), liangdianForward(12, 500, 1, 1000));
  });

  it.each(["fourPointSwing", "dualTiltFourPointSwing"] as const)(
    "%s matches PLC rope lengths for swing X and swing Y",
    (controlType) => {
      for (const direction of [1, 2] as const) {
        const config = configOf(controlType, FOUR_POINT, direction);
        for (const [v1, v2, v3] of [
          [600, 14, 0],
          [600, -9, 0],
          [900, 0, 11],
          [900, 0, -17],
        ] as const) {
          expectLengths(
            ropeLengthsFrom3D(config, { v1, v2, v3 }),
            sidianForward(v2, v3, v1, direction, 1200, 600),
          );
        }
      }
    },
  );

  it("four-point swing Y > 0 lowers the z < 0 side (hoists 0/1)", () => {
    const config = configOf("fourPointSwing", FOUR_POINT);
    const t = resolveVirtualAxisTransform(config, { v1: 0, v3: 10 });
    const ys = config.hoistAxes!.map((axis) => toWorld(config, t, hoistLocal(config, axis.mount)).y);
    expect(ys[0]).toBeLessThan(4.3);
    expect(ys[1]).toBeLessThan(4.3);
    expect(ys[2]).toBeGreaterThan(4.3);
    expect(ys[3]).toBeGreaterThan(4.3);
  });

  it.each([1, 2] as const)("multi-point swing matches PLC rope lengths (direction %i)", (direction) => {
    for (const betaInit of [0, 35]) {
      const config = configOf("multiPointSwing", MULTI_POINT, direction, betaInit);
      for (const [v1, v2, v3] of [
        [500, 0, 0],
        [500, 12, 0],
        [800, 8, 60],
        [1500, -15, 200],
      ] as const) {
        const expected = solveMultiPointForward({
          height: v1,
          roll: v3,
          pitch: v2,
          pointInitPos: MULTI_POINT.map((mount) => [mount.x, mount.z, 0]),
          baseHeight1: direction === 1 ? PULLEY_MM : 0,
          baseHeight2: direction === 2 ? PULLEY_MM : 0,
          maxHeight: MAX_HEIGHT_MM,
          betaInit,
        });
        expectLengths(ropeLengthsFrom3D(config, { v1, v2, v3 }), expected);
      }
    }
  });

  it("multi-point yaw (v3) alone does not rotate the model", () => {
    const config = configOf("multiPointSwing", MULTI_POINT, 1, 20);
    const t = resolveVirtualAxisTransform(config, { v1: 300, v2: 0, v3: 75 });
    const q = t.rotationQuaternion!;
    expect(Math.abs(q.w)).toBeCloseTo(1, 9);
    expect(t.pivotPosition!.x).toBeCloseTo(0, 9);
    expect(t.pivotPosition!.z).toBeCloseTo(0, 9);
  });

  it("multi-point yaw only changes the tilt direction, not the tilt amount", () => {
    const config = configOf("multiPointSwing", MULTI_POINT);
    const tiltOf = (v3: number) => {
      const q = resolveVirtualAxisTransform(config, { v1: 0, v2: 10, v3 }).rotationQuaternion!;
      return rotateByQuat(q, { x: 0, y: 1, z: 0 });
    };
    const a = tiltOf(0);
    const b = tiltOf(90);
    expect(a.y).toBeCloseTo(Math.cos(10 * DEG), 9);
    expect(b.y).toBeCloseTo(Math.cos(10 * DEG), 9);
    expect(a.x * b.x + a.z * b.z).toBeCloseTo(0, 9);
  });
});
