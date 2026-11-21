import {
  isPassThroughMotion,
  type ResolvedMotionSegment,
} from "@/app/project/action-sequence/resolve-sequence";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { maxAccelerationOf, resolveEnabledAxes } from "../motion-profile/motion-profile-status";
import {
  profileForDuration,
  type AxisRateLimits,
  type SegmentRampAxis,
} from "../motion-profile/segment-presets";
import type { SegmentRetimeWrite } from "../sequence-ops";
import type { ControlledObject } from "../timeline/timeline-data";
import { segmentEditContext } from "./segment-editor";

export type RampAxis = SegmentRampAxis & { axis: VirtualAxisId };

/** 一个轴在搭建里设的默认速度、加速度和上限 */
export const axisRateLimits = (
  object: ControlledObject | undefined,
  axis: VirtualAxisId,
  maxAccel: number | undefined,
): AxisRateLimits => ({
  defaultSpeed: object?.defaultSpeedByAxis?.[axis],
  defaultAccel: object?.defaultAccelByAxis?.[axis],
  maxSpeed: object?.maxSpeedByAxis?.[axis],
  maxAccel,
});

/** 一台物体各轴的默认值和上限（最大加减速度 = 最大速度 / 最短加速时间） */
export const objectRateLimits = (
  object: ControlledObject | undefined,
): Partial<Record<VirtualAxisId, AxisRateLimits>> => {
  const limits: Partial<Record<VirtualAxisId, AxisRateLimits>> = {};
  for (const axis of ["v1", "v2", "v3"] as const) {
    const maxSpeed = object?.maxSpeedByAxis?.[axis];
    const minAccelTime = object?.minAccelTimeByAxis?.[axis];
    const maxAccel =
      maxSpeed !== undefined && minAccelTime !== undefined && minAccelTime > 0 ? maxSpeed / minAccelTime : undefined;
    limits[axis] = axisRateLimits(object, axis, maxAccel);
  }
  return limits;
};

/** 这段自己的、在动的梯形轴：起步收尾的档位、参考时长和改时长都只管它们 */
export const segmentRampAxes = (
  segment: ResolvedMotionSegment,
  object: ControlledObject | undefined,
): RampAxis[] => {
  const { motions, axisContext } = segmentEditContext(segment, object);
  return resolveEnabledAxes(axisContext.enabledAxes).flatMap((axis) => {
    const motion = motions[axis];
    const distance = Math.abs(motion.to - motion.from);
    if (isPassThroughMotion(segment, motion) || !(distance > 0) || motion.profile.kind !== "trapezoid") {
      return [];
    }
    return [
      {
        axis,
        profile: motion.profile,
        distance,
        durationMs: motion.durationMs,
        boundary: { startSpeed: motion.startSpeed, endSpeed: motion.endSpeed },
        limits: axisRateLimits(object, axis, maxAccelerationOf(axis, axisContext)),
      },
    ];
  });
};

/**
 * 把一段改成 nextMs：终点和这个物体后面的块一起挪；起步收尾在档上的按档位重算，
 * 不在档上的保留变速时间。没有在动的轴时也写一条，好让终点挪过去。
 */
export const segmentDurationWrites = (
  segment: ResolvedMotionSegment,
  object: ControlledObject | undefined,
  nextMs: number,
): SegmentRetimeWrite[] => {
  const base = {
    objectId: segment.objectId,
    fromRef: segment.fromRef,
    toRef: segment.toRef,
    durationMs: nextMs,
  };
  const axes = segmentRampAxes(segment, object);
  if (axes.length === 0) return [{ ...base, axis: "v1", profile: segment.settings.profiles.v1 }];
  return axes.map((axis) => ({ ...base, axis: axis.axis, profile: profileForDuration(axis, nextMs) }));
};

/** 统一时长：选中的每段都改成 nextMs（各物体后面的块跟着挪）；已经是这个时长、不能改的段跳过 */
export const uniformDurationWrites = (
  segments: readonly ResolvedMotionSegment[],
  objectOf: (objectId: number) => ControlledObject | undefined,
  nextMs: number,
): SegmentRetimeWrite[] =>
  nextMs > 0
    ? segments.flatMap((segment) =>
        segment.configurable && segment.durationMs !== nextMs
          ? segmentDurationWrites(segment, objectOf(segment.objectId), nextMs)
          : [],
      )
    : [];
