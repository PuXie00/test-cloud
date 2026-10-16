import {
  boundaryTrapezoidKinematics,
  boundaryTrapezoidOf,
  calculateMotionProfileKinematics,
  hasMotionBoundary,
  type MotionBoundary,
  type MotionProfileKinematics,
} from "@/app/project/action-sequence/motion-profile";
import type { AxisMotionProfiles, ModelPose, MotionProfile } from "@/app/project/action-sequence/types";
import type { ControlType } from "@/app/project/configuration-types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { VIRTUAL_AXIS_IDS } from "../timeline/timeline-data";

export type MotionProfileAxisContext = {
  enabledAxes: VirtualAxisId[];
  travel: Pick<ModelPose, VirtualAxisId>;
  durationMs: number;
  /** 轴跟随的曲线比区间长（轴在端点位姿上不设定）时各轴自己的时长 */
  durationMsByAxis?: Partial<Record<VirtualAxisId, number>>;
  /** 连续衔接时这段的进入、离开速度 */
  boundaryByAxis?: Partial<Record<VirtualAxisId, MotionBoundary>>;
  controlType?: ControlType;
  maxSpeedByAxis?: Partial<Record<VirtualAxisId, number>>;
  minAccelTimeByAxis?: Partial<Record<VirtualAxisId, number>>;
};

export const axisDurationMs = (
  axisContext: Pick<MotionProfileAxisContext, "durationMs" | "durationMsByAxis">,
  axis: VirtualAxisId,
): number => axisContext.durationMsByAxis?.[axis] ?? axisContext.durationMs;

export const resolveEnabledAxes = (enabledAxes: VirtualAxisId[]): VirtualAxisId[] =>
  enabledAxes.length > 0 ? enabledAxes : [...VIRTUAL_AXIS_IDS];

export const minAccelMsOf = (
  axis: VirtualAxisId,
  axisContext: MotionProfileAxisContext,
): number | undefined => {
  const sec = axisContext.minAccelTimeByAxis?.[axis];
  if (sec === undefined || !Number.isFinite(sec) || sec <= 0) return undefined;
  return sec * 1000;
};

export const tryKinematics = (
  profile: MotionProfile,
  distance: number,
  durationMs: number,
  boundary?: MotionBoundary,
): MotionProfileKinematics | null => {
  if (profile.kind === "trapezoid" && distance > 0 && boundary && hasMotionBoundary(boundary)) {
    const shape = boundaryTrapezoidOf(profile, distance, durationMs, boundary);
    return shape ? boundaryTrapezoidKinematics(shape) : null;
  }
  if (profile.kind === "idle") {
    try {
      return calculateMotionProfileKinematics(profile, 0, durationMs);
    } catch {
      return null;
    }
  }
  if (durationMs <= 0 || distance <= 0) return null;
  try {
    return calculateMotionProfileKinematics(profile, distance, durationMs);
  } catch {
    return null;
  }
};

/** 加减速度上限 = 最大速度 / 最短加减速时间，和序列校验、下发 PLC 一致 */
export const maxAccelerationOf = (
  axis: VirtualAxisId,
  axisContext: MotionProfileAxisContext,
): number | undefined => {
  const speed = axisContext.maxSpeedByAxis?.[axis];
  const sec = axisContext.minAccelTimeByAxis?.[axis];
  if (speed === undefined || sec === undefined || !(speed > 0) || !(sec > 0)) return undefined;
  return speed / sec;
};

const ACCELERATION_SLACK = 1 + 1e-9;

/** 时长放不下两段变速、或加减速度超过上限时的提示 */
export const profileLimitWarnings = (
  profile: MotionProfile,
  durationMs: number,
  kinematics: MotionProfileKinematics | null,
  maxAcceleration: number | undefined,
  formatAcceleration: (value: number) => string = (value) => String(Math.round(value * 10) / 10),
): string[] => {
  if (profile.kind === "idle") return [];
  const warnings: string[] = [];
  if (profile.params.accelMs + profile.params.decelMs >= durationMs) {
    warnings.push("加速与减速时间之和不小于区间时长");
  }
  if (kinematics && maxAcceleration !== undefined) {
    const limit = formatAcceleration(maxAcceleration);
    if (kinematics.acceleration > maxAcceleration * ACCELERATION_SLACK) {
      warnings.push(`加速度 ${formatAcceleration(kinematics.acceleration)} 超过上限 ${limit}`);
    }
    if (kinematics.deceleration > maxAcceleration * ACCELERATION_SLACK) {
      warnings.push(`减速度 ${formatAcceleration(kinematics.deceleration)} 超过上限 ${limit}`);
    }
  }
  return warnings;
};

export const axisHasWarning = (
  axis: VirtualAxisId,
  profiles: AxisMotionProfiles,
  axisContext: MotionProfileAxisContext,
): boolean => {
  const axisProfile = profiles[axis];
  if (axisProfile.kind === "idle" || Math.abs(axisContext.travel[axis] ?? 0) === 0) {
    return false;
  }
  const boundary = axisContext.boundaryByAxis?.[axis];
  const axisDistance = Math.abs(axisContext.travel[axis] ?? 0);
  const axisKinematics = tryKinematics(
    axisProfile,
    axisDistance,
    axisDurationMs(axisContext, axis),
    boundary,
  );
  if (
    profileLimitWarnings(
      axisProfile,
      axisDurationMs(axisContext, axis),
      axisKinematics,
      maxAccelerationOf(axis, axisContext),
    ).length > 0
  ) {
    return true;
  }
  // 带着经过速度进来却完不成变速
  if (axisKinematics === null && hasMotionBoundary(boundary)) return true;
  const axisMaxSpeed = axisContext.maxSpeedByAxis?.[axis];
  return (
    axisKinematics !== null &&
    axisMaxSpeed !== undefined &&
    axisKinematics.peakVelocity > axisMaxSpeed
  );
};

export const motionProfileSegmentStatus = (
  profiles: AxisMotionProfiles,
  axisContext: MotionProfileAxisContext,
  disabled: boolean,
): { label: string; className: string } => {
  const hasWarning = resolveEnabledAxes(axisContext.enabledAxes).some((axis) =>
    axisHasWarning(axis, profiles, axisContext),
  );
  return {
    label: disabled ? "只读" : hasWarning ? "需检查" : "配置有效",
    className: hasWarning && !disabled ? "text-warning" : "text-show",
  };
};
