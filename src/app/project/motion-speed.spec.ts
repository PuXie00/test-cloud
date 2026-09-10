import { describe, expect, it } from "vitest";
import { MOTION_DEFAULTS } from "./configuration-rules";
import {
  deriveMotionParamsFromSpeedControl,
  type MotionSpeedControl,
} from "./motion-speed";

const control: MotionSpeedControl = { speedRatio: 1.5 };

describe("deriveMotionParamsFromSpeedControl", () => {
  it("clamps derived swing speed to resolved v2/v3 max", () => {
    const next = deriveMotionParamsFromSpeedControl(
      {
        move: { ...MOTION_DEFAULTS.move, speed: 80 },
        swingX: { ...MOTION_DEFAULTS.swingX, speed: 9 },
      },
      ["move", "swingX"],
      control,
      200,
      { v1: 500, v2: 3 },
    );
    expect(next.swingX?.speed).toBeLessThanOrEqual(3);
    expect(next.move?.speed).toBeLessThanOrEqual(500);
  });

  it("clamps derived speeds to a resolved max below the maxAxisVelocity formula", () => {
    const next = deriveMotionParamsFromSpeedControl(
      {
        move: { ...MOTION_DEFAULTS.move, speed: 80 },
        swingX: { ...MOTION_DEFAULTS.swingX, speed: 9 },
      },
      ["move", "swingX"],
      control,
      200,
      { v1: 40, v2: 1 },
    );
    expect(next.swingX?.speed).toBeLessThanOrEqual(1);
    expect(next.move?.speed).toBeLessThanOrEqual(40);
  });

  it("clamps override speed to resolved axis max", () => {
    const next = deriveMotionParamsFromSpeedControl(
      {
        swingX: { ...MOTION_DEFAULTS.swingX, speed: 9 },
      },
      ["swingX"],
      {
        speedRatio: 1,
        overrides: { swingX: { enabled: true, speed: 9 } },
      },
      200,
      { v2: 3 },
    );
    expect(next.swingX?.speed).toBeLessThanOrEqual(3);
  });
});
