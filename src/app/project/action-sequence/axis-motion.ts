import { roundProjectCoordinate } from "../project-quantity";
import { axisKinematics, ZERO_AXIS_KINEMATICS, type AxisKinematics } from "./axis-kinematics";
import {
  boundaryTrapezoidDistanceAt,
  boundaryTrapezoidOf,
  boundaryTrapezoidSpeedAt,
  calculateMotionProfileKinematics,
  evaluateMotionProfile,
  hasMotionBoundary,
  sampleVelocityNorm,
  type BoundaryTrapezoid,
} from "./motion-profile";
import type { ResolvedAxisMotion } from "./resolve-sequence";

/** 带进出速度的曲线形状；放不下变速时为 null */
export const axisMotionShape = (motion: ResolvedAxisMotion): BoundaryTrapezoid | null =>
  boundaryTrapezoidOf(motion.profile, Math.abs(motion.to - motion.from), motion.durationMs, motion);

const requireShape = (motion: ResolvedAxisMotion): BoundaryTrapezoid => {
  const shape = axisMotionShape(motion);
  if (!shape) throw new Error("invalid trapezoid motion profile");
  return shape;
};

/** 轴曲线在某一时刻的位置（时刻在曲线范围外时取端点） */
export const axisMotionValueAt = (motion: ResolvedAxisMotion, atMs: number): number => {
  const travel = motion.to - motion.from;
  if (travel === 0 || motion.durationMs <= 0) return atMs < motion.endMs ? motion.from : motion.to;
  if (hasMotionBoundary(motion)) {
    const distance = boundaryTrapezoidDistanceAt(requireShape(motion), (atMs - motion.startMs) / 1000);
    return motion.from + Math.sign(travel) * distance;
  }
  const progress = (atMs - motion.startMs) / motion.durationMs;
  return motion.from + travel * evaluateMotionProfile(motion.profile, progress, motion.durationMs);
};

/** 轴曲线在某一时刻的带符号速度，单位/秒 */
export const axisMotionVelocityAt = (motion: ResolvedAxisMotion, atMs: number): number => {
  const travel = motion.to - motion.from;
  if (motion.profile.kind === "idle" || travel === 0 || motion.durationMs <= 0) return 0;
  if (hasMotionBoundary(motion)) {
    return (
      Math.sign(travel) * boundaryTrapezoidSpeedAt(requireShape(motion), (atMs - motion.startMs) / 1000)
    );
  }
  const tNorm = (atMs - motion.startMs) / motion.durationMs;
  const { peakVelocity } = calculateMotionProfileKinematics(motion.profile, travel, motion.durationMs);
  return Math.sign(travel) * peakVelocity * sampleVelocityNorm(motion.profile, tNorm, motion.durationMs);
};

/** 匀速大小；曲线不合法时为 0 */
export const axisMotionCruiseSpeed = (motion: ResolvedAxisMotion): number => {
  const distance = Math.abs(motion.to - motion.from);
  if (distance === 0 || motion.profile.kind !== "trapezoid") return 0;
  if (hasMotionBoundary(motion)) return axisMotionShape(motion)?.cruiseSpeed ?? 0;
  try {
    return calculateMotionProfileKinematics(motion.profile, distance, motion.durationMs).peakVelocity;
  } catch {
    return 0;
  }
};

/** 下发给 C++ 的速度、加减速：速度取匀速，加减速度是段首、段尾变速的变化率 */
export const axisMotionKinematics = (motion: ResolvedAxisMotion): AxisKinematics => {
  const travel = motion.to - motion.from;
  if (!hasMotionBoundary(motion)) return axisKinematics(motion.profile, travel, motion.durationMs);
  const shape = axisMotionShape(motion);
  if (!shape) return ZERO_AXIS_KINEMATICS;
  return {
    vel: roundProjectCoordinate(shape.cruiseSpeed),
    accVel: roundProjectCoordinate(Math.abs(shape.cruiseSpeed - shape.startSpeed) / shape.accelSec),
    decVel: roundProjectCoordinate(Math.abs(shape.cruiseSpeed - shape.endSpeed) / shape.decelSec),
  };
};
