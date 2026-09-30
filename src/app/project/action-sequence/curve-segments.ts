import type { PlcCurveSegment } from "@shared/csocket/action-data-save";
import { roundProjectCoordinate } from "../project-quantity";
import {
  calculateMotionProfileKinematics,
  cruiseMsOf,
  evaluateMotionProfile,
} from "./motion-profile";
import type { MotionProfile } from "./types";

/** PLC 用 t = startTime(ms) / 100，即 0.1s。P = A + B t + C t²。 */
const TICK_PER_SEC = 10;

const snapPlc = (value: number): number => roundProjectCoordinate(value);

const isHold = (segment: PlcCurveSegment): boolean =>
  segment.b === 0 && segment.c === 0 && segment.d === 0 && segment.e === 0 && segment.f === 0;

const holdSegment = (startTime: number, position: number): PlcCurveSegment => {
  const snapped = snapPlc(position);
  return {
    startTime,
    position: snapped,
    a: snapped,
    b: 0,
    c: 0,
    d: 0,
    e: 0,
    f: 0,
  };
};

const phaseSegment = (
  startTime: number,
  position: number,
  velocityPerSec: number,
  accelPerSec2: number,
): PlcCurveSegment => {
  const snapped = snapPlc(position);
  return {
    startTime,
    position: snapped,
    a: snapped,
    b: snapPlc(velocityPerSec / TICK_PER_SEC),
    c: snapPlc(accelPerSec2 / (2 * TICK_PER_SEC * TICK_PER_SEC)),
    d: 0,
    e: 0,
    f: 0,
  };
};

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
  const cruiseVelocity = sign * kinematics.peakVelocity;
  const rows = [
    phaseSegment(startMs, startPos, 0, sign * kinematics.acceleration),
    phaseSegment(
      startMs + accelMs + cruiseMs,
      cruiseEndPos,
      cruiseVelocity,
      -sign * kinematics.deceleration,
    ),
  ];
  if (cruiseMs > 0) {
    rows.splice(
      1,
      0,
      phaseSegment(startMs + accelMs, accelEndPos, cruiseVelocity, 0),
    );
  }
  return rows;
};

/** 连续静止点只留第一点，并在总时长处补零速终点。 */
export const finalizePlcTimeline = (
  segments: PlcCurveSegment[],
  endMs: number,
  endPos: number,
): PlcCurveSegment[] => {
  const collapsed: PlcCurveSegment[] = [];
  for (const segment of segments) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && isHold(prev) && isHold(segment) && prev.position === snapPlc(segment.position)) {
      continue;
    }
    collapsed.push(segment);
  }
  const last = collapsed[collapsed.length - 1];
  if (!last || last.startTime < endMs) {
    collapsed.push(holdSegment(endMs, endPos));
  }
  return collapsed;
};
