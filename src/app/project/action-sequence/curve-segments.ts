import type { PlcCurveSegment } from "@shared/csocket/action-data-save";
import {
  calculateMotionProfileKinematics,
  cruiseMsOf,
  evaluateMotionProfile,
} from "./motion-profile";
import type { MotionProfile } from "./types";

const ZERO_COEFF = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };

const snap = (value: number): number => Number(value.toPrecision(15));

const holdSegment = (startTime: number, position: number): PlcCurveSegment => ({
  startTime,
  position: snap(position),
  ...ZERO_COEFF,
});

export const trapezoidToCurveSegments = (
  profile: MotionProfile,
  startMs: number,
  startPos: number,
  endPos: number,
  durationMs: number,
): PlcCurveSegment[] => {
  const travel = endPos - startPos;
  if (profile.kind !== "trapezoid" || travel === 0) {
    return [holdSegment(startMs, startPos)];
  }

  const sign = Math.sign(travel);
  const kinematics = calculateMotionProfileKinematics(profile, travel, durationMs);
  const accelMs = profile.params.accelMs;
  const cruiseMs = Math.max(0, cruiseMsOf(profile, durationMs));
  const accelEndPos =
    startPos + evaluateMotionProfile(profile, accelMs / durationMs, durationMs) * travel;
  const cruiseEndPos =
    startPos +
    evaluateMotionProfile(profile, (accelMs + cruiseMs) / durationMs, durationMs) * travel;
  const cruiseStartTime = startMs + accelMs;
  const decelStartTime = cruiseStartTime + cruiseMs;

  return [
    { ...holdSegment(startMs, startPos), a: snap(sign * kinematics.acceleration) },
    {
      ...holdSegment(cruiseStartTime, accelEndPos),
      b: cruiseMs === 0 ? 0 : snap(sign * kinematics.peakVelocity),
    },
    { ...holdSegment(decelStartTime, cruiseEndPos), c: snap(sign * kinematics.deceleration) },
  ];
};
