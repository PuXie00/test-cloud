import {
  calculateMotionProfileKinematics,
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
  controlType?: ControlType;
  maxSpeedByAxis?: Partial<Record<VirtualAxisId, number>>;
  minAccelTimeByAxis?: Partial<Record<VirtualAxisId, number>>;
};

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
): MotionProfileKinematics | null => {
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

export const phaseFloorWarningMessages = (
  profile: MotionProfile,
  durationMs: number,
  minAccelMs: number | undefined,
): string[] => {
  if (profile.kind === "idle") return [];
  const warnings: string[] = [];
  if (minAccelMs !== undefined) {
    const roundedMinMs = Math.round(minAccelMs);
    if (profile.params.accelMs < minAccelMs) {
      warnings.push(`加速短于最短加减速 ${roundedMinMs} ms`);
    }
    if (profile.params.decelMs < minAccelMs) {
      warnings.push(`减速短于最短加减速 ${roundedMinMs} ms`);
    }
    if (profile.params.accelMs + profile.params.decelMs >= durationMs) {
      warnings.push(`时长不足，加速与减速至少各需 ${roundedMinMs} ms`);
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
  const axisMinAccelMs = minAccelMsOf(axis, axisContext);
  if (
    phaseFloorWarningMessages(
      axisProfile,
      axisContext.durationMs,
      axisMinAccelMs,
    ).length > 0
  ) {
    return true;
  }
  const axisDistance = Math.abs(axisContext.travel[axis] ?? 0);
  const axisKinematics = tryKinematics(
    axisProfile,
    axisDistance,
    axisContext.durationMs,
  );
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
