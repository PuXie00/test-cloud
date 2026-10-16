import type { PlcCurveSegment } from "@shared/csocket/action-data-save";
import {
  boundaryTrapezoidDistanceAt,
  boundaryTrapezoidOf,
  calculateMotionProfileKinematics,
  cruiseMsOf,
  evaluateMotionProfile,
  hasMotionBoundary,
  type MotionBoundary,
} from "./motion-profile";
import type { MotionProfile } from "./types";

/** PLC 用 t = startTime(ms) / 100，即 0.1s。P = A + B t + C t²。 */
const TICK_PER_SEC = 10;

const finitePlc = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Object.is(value, -0) ? 0 : value;
};

const isHold = (segment: PlcCurveSegment): boolean =>
  segment.b === 0 && segment.c === 0 && segment.d === 0 && segment.e === 0 && segment.f === 0;

const holdSegment = (startTime: number, position: number): PlcCurveSegment => {
  const value = finitePlc(position);
  return {
    startTime,
    position: value,
    a: value,
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
  const value = finitePlc(position);
  return {
    startTime,
    position: value,
    a: value,
    b: finitePlc(velocityPerSec / TICK_PER_SEC),
    c: finitePlc(accelPerSec2 / (2 * TICK_PER_SEC * TICK_PER_SEC)),
    d: 0,
    e: 0,
    f: 0,
  };
};

/** 带进出速度：首行带进入速度，末段变到离开速度，下一段从这个速度接上 */
const boundaryCurveSegments = (
  profile: MotionProfile,
  startMs: number,
  startPos: number,
  travel: number,
  durationMs: number,
  boundary: MotionBoundary,
): PlcCurveSegment[] => {
  const shape = boundaryTrapezoidOf(profile, Math.abs(travel), durationMs, boundary);
  if (!shape) throw new Error("invalid trapezoid motion profile");
  const sign = Math.sign(travel);
  const at = (sec: number) => startPos + sign * boundaryTrapezoidDistanceAt(shape, sec);
  const rows = [
    phaseSegment(
      startMs,
      startPos,
      sign * shape.startSpeed,
      (sign * (shape.cruiseSpeed - shape.startSpeed)) / shape.accelSec,
    ),
  ];
  if (shape.cruiseSec > 0) {
    rows.push(phaseSegment(startMs + shape.accelSec * 1000, at(shape.accelSec), sign * shape.cruiseSpeed, 0));
  }
  if (shape.decelSec > 0) {
    const decelStartSec = shape.accelSec + shape.cruiseSec;
    rows.push(
      phaseSegment(
        startMs + decelStartSec * 1000,
        at(decelStartSec),
        sign * shape.cruiseSpeed,
        (-sign * (shape.cruiseSpeed - shape.endSpeed)) / shape.decelSec,
      ),
    );
  }
  return rows;
};

export const trapezoidToCurveSegments = (
  profile: MotionProfile,
  startMs: number,
  startPos: number,
  endPos: number,
  durationMs: number,
  boundary?: MotionBoundary,
): PlcCurveSegment[] => {
  const travel = endPos - startPos;
  if (profile.kind !== "trapezoid" || travel === 0) {
    return [holdSegment(startMs, startPos)];
  }
  if (boundary && hasMotionBoundary(boundary)) {
    return boundaryCurveSegments(profile, startMs, startPos, travel, durationMs, boundary);
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
    if (prev && isHold(prev) && isHold(segment) && prev.position === segment.position) {
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
