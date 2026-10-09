import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { HoistTravelDirection, Quat } from "../types";
import { resolveHoistTravel } from "./hoist-travel";

const expectQuatClose = (actual: Quat, expected: Quat): void => {
  // q 与 −q 表示同一旋转
  const dot = actual.x * expected.x + actual.y * expected.y + actual.z * expected.z + actual.w * expected.w;
  const sign = dot < 0 ? -1 : 1;
  expect(actual.x * sign).toBeCloseTo(expected.x, 9);
  expect(actual.y * sign).toBeCloseTo(expected.y, 9);
  expect(actual.z * sign).toBeCloseTo(expected.z, 9);
  expect(actual.w * sign).toBeCloseTo(expected.w, 9);
};

const liftOf = (position: number, direction: HoistTravelDirection): number => {
  const travel = resolveHoistTravel("linear", position, direction);
  if (travel.kind !== "linear") throw new Error("expected linear travel");
  return travel.lift;
};

const rotationOf = (position: number, direction: HoistTravelDirection): Quat => {
  const travel = resolveHoistTravel("rotary", position, direction);
  if (travel.kind !== "rotary") throw new Error("expected rotary travel");
  return travel.rotation;
};

/** 物体正前方 +Z 指针转过后的朝向 */
const pointerOf = (rotation: Quat): Vector3 =>
  new Vector3(0, 0, 1).applyRotationQuaternion(
    new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
  );

describe("resolveHoistTravel", () => {
  it("位置 0 为原位", () => {
    expect(liftOf(0, "forward")).toBeCloseTo(0, 12);
    expect(liftOf(0, "reverse")).toBeCloseTo(0, 12);
    expectQuatClose(rotationOf(0, "forward"), { x: 0, y: 0, z: 0, w: 1 });
  });

  it("线性：正向时位置增大向下，反向时向上，mm 换算为米", () => {
    expect(liftOf(1500, "forward")).toBeCloseTo(-1.5, 12);
    expect(liftOf(1500, "reverse")).toBeCloseTo(1.5, 12);
    expect(liftOf(-200, "forward")).toBeCloseTo(0.2, 12);
  });

  it("无极旋转：正向时位置增大俯视顺时针，反向时逆时针", () => {
    // 俯视（+Y 向下看，+X 在右、+Z 在上）顺时针 90°：+Z → +X
    const forward = pointerOf(rotationOf(90, "forward"));
    expect(forward.x).toBeCloseTo(1, 9);
    expect(forward.z).toBeCloseTo(0, 9);
    const reverse = pointerOf(rotationOf(90, "reverse"));
    expect(reverse.x).toBeCloseTo(-1, 9);
    expect(reverse.z).toBeCloseTo(0, 9);
  });

  it("无极旋转：反向等于角度取反，多圈与取模后等价", () => {
    const forward = rotationOf(30, "forward");
    expectQuatClose(rotationOf(-30, "reverse"), forward);
    expectQuatClose(rotationOf(30 + 720, "forward"), forward);
  });
});
