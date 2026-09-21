import { describe, expect, it } from "vitest";
import { roundProjectCoordinate } from "../project-quantity";
import { axisKinematics, ZERO_AXIS_KINEMATICS } from "./axis-kinematics";
import { calculateMotionProfileKinematics } from "./motion-profile";
import type { MotionProfile } from "./types";

const trap = (accelMs: number, decelMs: number): MotionProfile => ({
  kind: "trapezoid",
  params: { accelMs, decelMs },
});

describe("axisKinematics", () => {
  it("returns zeros for idle or zero travel", () => {
    expect(axisKinematics({ kind: "idle" }, 100, 1000)).toEqual(ZERO_AXIS_KINEMATICS);
    expect(axisKinematics(trap(150, 250), 0, 1000)).toEqual(ZERO_AXIS_KINEMATICS);
  });

  it("emits rounded absolute trapezoid kinematics even when travel is negative", () => {
    const profile = trap(150, 250);
    const positive = calculateMotionProfileKinematics(profile, 1000, 1000);
    const expected = {
      vel: roundProjectCoordinate(Math.abs(positive.peakVelocity)),
      accVel: roundProjectCoordinate(Math.abs(positive.acceleration)),
      decVel: roundProjectCoordinate(Math.abs(positive.deceleration)),
    };
    expect(axisKinematics(profile, 1000, 1000)).toEqual(expected);
    expect(axisKinematics(profile, -1000, 1000)).toEqual(expected);
    expect(expected.vel).toBeGreaterThan(0);
    expect(expected.accVel).toBeGreaterThan(0);
    expect(expected.decVel).toBeGreaterThan(0);
  });

  it("throws on unsupported profile kinds", () => {
    const cubic = { kind: "cubic" } as unknown as MotionProfile;
    expect(() => axisKinematics(cubic, 10, 1000)).toThrow(/unsupported motion profile: cubic/);
  });
});
