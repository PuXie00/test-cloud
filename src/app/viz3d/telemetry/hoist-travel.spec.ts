import { describe, expect, it } from "vitest";
import type { ControlType } from "@/app/project/configuration-types";
import type { Quat, SceneObjectConfig } from "../types";
import { resolveHoistTravel } from "./hoist-travel";
import { resolveVirtualAxisTransform } from "./virtual-axis-mapper";

const configOf = (controlType: ControlType, runDirection: 1 | 2): SceneObjectConfig => ({
  id: "co-1",
  shape: "cube",
  dimensions: { w: 1, h: 1, d: 1 },
  position: { x: 0, y: 4, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#4cd6fb",
  kinematics: { controlType, runDirection, pulleyDistance: 100, maxHeight: 3000, betaInit: 0 },
});

const expectQuatClose = (actual: Quat, expected: Quat): void => {
  // q 与 −q 表示同一旋转
  const dot = actual.x * expected.x + actual.y * expected.y + actual.z * expected.z + actual.w * expected.w;
  const sign = dot < 0 ? -1 : 1;
  expect(actual.x * sign).toBeCloseTo(expected.x, 9);
  expect(actual.y * sign).toBeCloseTo(expected.y, 9);
  expect(actual.z * sign).toBeCloseTo(expected.z, 9);
  expect(actual.w * sign).toBeCloseTo(expected.w, 9);
};

const liftOf = (position: number, runDirection: 1 | 2): number => {
  const travel = resolveHoistTravel("linear", position, runDirection);
  if (travel.kind !== "linear") throw new Error("expected linear travel");
  return travel.lift;
};

const rotationOf = (position: number, runDirection: 1 | 2): Quat => {
  const travel = resolveHoistTravel("rotary", position, runDirection);
  if (travel.kind !== "rotary") throw new Error("expected rotary travel");
  return travel.rotation;
};

describe("resolveHoistTravel", () => {
  it("位置 0 为原位", () => {
    expect(liftOf(0, 1)).toBeCloseTo(0, 12);
    expect(liftOf(0, 2)).toBeCloseTo(0, 12);
    expectQuatClose(rotationOf(0, 1), { x: 0, y: 0, z: 0, w: 1 });
  });

  it("线性：正向时位置增大向下，反向时向上，mm 换算为米", () => {
    expect(liftOf(1500, 1)).toBeCloseTo(-1.5, 12);
    expect(liftOf(1500, 2)).toBeCloseTo(1.5, 12);
    expect(liftOf(-200, 1)).toBeCloseTo(0.2, 12);
  });

  it.each([1, 2] as const)("线性与控制页单点升降一致（方向 %i）", (runDirection) => {
    const config = configOf("singlePointMove", runDirection);
    const control = resolveVirtualAxisTransform(config, { v1: 820 });
    expect(liftOf(820, runDirection)).toBeCloseTo(control.position.y - config.position.y, 12);
  });

  it.each([1, 2] as const)("无极旋转与控制页旋转一致（方向 %i）", (runDirection) => {
    const control = resolveVirtualAxisTransform(configOf("continuousRotation", runDirection), { v1: 135 });
    expectQuatClose(rotationOf(135, runDirection), control.rotationQuaternion!);
  });

  it("无极旋转：反向时角度取反，多圈与取模后等价", () => {
    const forward = rotationOf(30, 1);
    const reverse = rotationOf(-30, 2);
    expectQuatClose(reverse, forward);
    expectQuatClose(rotationOf(30 + 720, 1), forward);
  });
});
