import { cn } from "@/app/components/ui/utils";
import {
  segmentAxisMotion,
  type ResolvedAxisMotion,
  type ResolvedMotionSegment,
} from "@/app/project/action-sequence/resolve-sequence";
import type { AxisMotionProfiles, ModelPose } from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import type { MotionProfileAxisContext } from "../motion-profile/motion-profile-editor";
import { motionProfileSegmentStatus } from "../motion-profile/motion-profile-status";
import { VIRTUAL_AXIS_IDS, type ControlledObject } from "../timeline/timeline-data";

export const axisContextFromObject = (
  object: ControlledObject | undefined,
  travel: ModelPose,
  durationMs: number,
): MotionProfileAxisContext => ({
  enabledAxes: object?.enabledAxes?.length ? object.enabledAxes : VIRTUAL_AXIS_IDS,
  travel,
  durationMs,
  controlType: object?.controlType,
  maxSpeedByAxis: object?.maxSpeedByAxis,
  minAccelTimeByAxis: object?.minAccelTimeByAxis,
});

export const segmentMotions = (
  segment: ResolvedMotionSegment,
): Record<VirtualAxisId, ResolvedAxisMotion> => ({
  v1: segmentAxisMotion(segment, "v1"),
  v2: segmentAxisMotion(segment, "v2"),
  v3: segmentAxisMotion(segment, "v3"),
});

/** 区间各轴的曲线、行程和编辑器要的轴上下文（跨过端点的轴用整段曲线的时长和进出速度） */
export const segmentEditContext = (
  segment: ResolvedMotionSegment,
  object: ControlledObject | undefined,
) => {
  const motions = segmentMotions(segment);
  const travel: ModelPose = {
    v1: motions.v1.to - motions.v1.from,
    v2: motions.v2.to - motions.v2.from,
    v3: motions.v3.to - motions.v3.from,
  };
  const profiles: AxisMotionProfiles = {
    v1: motions.v1.profile,
    v2: motions.v2.profile,
    v3: motions.v3.profile,
  };
  const axisContext: MotionProfileAxisContext = {
    ...axisContextFromObject(object, travel, segment.durationMs),
    durationMsByAxis: {
      v1: motions.v1.durationMs,
      v2: motions.v2.durationMs,
      v3: motions.v3.durationMs,
    },
    boundaryByAxis: {
      v1: motions.v1,
      v2: motions.v2,
      v3: motions.v3,
    },
  };
  return { motions, profiles, axisContext };
};

export const segmentStatusOf = (
  segment: ResolvedMotionSegment,
  object: ControlledObject | undefined,
) => {
  const { profiles, axisContext } = segmentEditContext(segment, object);
  return motionProfileSegmentStatus(profiles, axisContext, !segment.configurable);
};

export const SegmentStatusBadge = ({ status }: { status: { label: string; className: string } }) => (
  <p className={cn("shrink-0 text-body-sm", status.className)}>
    <span aria-hidden>●</span> {status.label}
  </p>
);
