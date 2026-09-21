import { roundProjectCoordinate } from "../project-quantity";
import { calculateMotionProfileKinematics } from "./motion-profile";
import type { MotionProfile } from "./types";

export type AxisKinematics = {
  vel: number;
  accVel: number;
  decVel: number;
};

export const ZERO_AXIS_KINEMATICS: AxisKinematics = {
  vel: 0,
  accVel: 0,
  decVel: 0,
};

export const axisKinematics = (
  profile: MotionProfile,
  travel: number,
  durationMs: number,
): AxisKinematics => {
  if (profile.kind === "idle" || travel === 0) return ZERO_AXIS_KINEMATICS;
  if (profile.kind === "trapezoid") {
    const kinematics = calculateMotionProfileKinematics(profile, travel, durationMs);
    return {
      vel: roundProjectCoordinate(Math.abs(kinematics.peakVelocity)),
      accVel: roundProjectCoordinate(Math.abs(kinematics.acceleration)),
      decVel: roundProjectCoordinate(Math.abs(kinematics.deceleration)),
    };
  }
  throw new Error(`unsupported motion profile: ${String((profile as { kind: string }).kind)}`);
};
