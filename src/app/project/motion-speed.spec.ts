import { describe, expect, it } from "vitest";
import { MOTION_DEFAULTS } from "./configuration-rules";
import {
  deriveMotionParamsFromSpeedControl,
  inferMotionSpeedControl,
  keepSpeedOverrides,
  type MotionSpeedControl,
} from "./motion-speed";

const control: MotionSpeedControl = { speedRatio: 1.5 };

describe("deriveMotionParamsFromSpeedControl", () => {
  it("clamps derived swing speed to resolved v2/v3 max", () => {
    const next = deriveMotionParamsFromSpeedControl(
      {
        h: { ...MOTION_DEFAULTS.move, speed: 80 },
        p: { ...MOTION_DEFAULTS.swingX, speed: 9 },
      },
      ["move", "swingX"],
      control,
      200,
      { v1: 500, v2: 3 },
    );
    expect(next.p?.speed).toBeLessThanOrEqual(3);
    expect(next.h?.speed).toBeLessThanOrEqual(500);
  });

  it("clamps derived speeds to a resolved max below the maxAxisVelocity formula", () => {
    const next = deriveMotionParamsFromSpeedControl(
      {
        h: { ...MOTION_DEFAULTS.move, speed: 80 },
        p: { ...MOTION_DEFAULTS.swingX, speed: 9 },
      },
      ["move", "swingX"],
      control,
      200,
      { v1: 40, v2: 1 },
    );
    expect(next.p?.speed).toBeLessThanOrEqual(1);
    expect(next.h?.speed).toBeLessThanOrEqual(40);
  });

  it("clamps override speed to resolved axis max", () => {
    const next = deriveMotionParamsFromSpeedControl(
      {
        p: { ...MOTION_DEFAULTS.swingX, speed: 9 },
      },
      ["swingX"],
      {
        speedRatio: 1,
        overrides: { p: { enabled: true, speed: 9 } },
      },
      200,
      { v2: 3 },
    );
    expect(next.p?.speed).toBeLessThanOrEqual(3);
  });
});

describe("inferMotionSpeedControl", () => {
  it("infers the ratio from h when h is the hoist axis", () => {
    const motionParams = { h: { ...MOTION_DEFAULTS.move, speed: 75 } };
    expect(inferMotionSpeedControl(motionParams, 200, ["move"]).speedRatio).toBe(1.5);
  });

  it("ignores h speed when h is a rotation axis", () => {
    const motionParams = { h: { ...MOTION_DEFAULTS.rotation, speed: 75 } };
    expect(inferMotionSpeedControl(motionParams, 200, ["rotation"]).speedRatio).toBe(1);
  });
});

describe("keepSpeedOverrides", () => {
  it("keeps only overrides of the listed axes", () => {
    const control: MotionSpeedControl = {
      speedRatio: 1.2,
      overrides: { h: { enabled: true, speed: 80 }, p: { enabled: true, speed: 2 } },
    };
    expect(keepSpeedOverrides(control, ["p"])).toEqual({
      speedRatio: 1.2,
      overrides: { p: { enabled: true, speed: 2 } },
    });
  });

  it("returns the control untouched when there are no overrides", () => {
    const control: MotionSpeedControl = { speedRatio: 1 };
    expect(keepSpeedOverrides(control, [])).toBe(control);
    expect(keepSpeedOverrides(undefined, ["h"])).toBeUndefined();
  });
});
