import { cn } from "@/app/components/ui/utils";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import { formatRepairItems } from "@/app/project/action-sequence/preset-repair";
import {
  isPassThroughMotion,
  segmentAxisMotion,
  type ResolvedAxisMotion,
  type ResolvedMotionSegment,
} from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  AxisMotionProfiles,
  ModelPose,
  MotionSegmentSettings,
} from "@/app/project/action-sequence/types";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import {
  MotionProfileEditor,
  type MotionProfileAxisContext,
} from "../motion-profile/motion-profile-editor";
import { motionProfileSegmentStatus } from "../motion-profile/motion-profile-status";
import { formatQuantity } from "../motion-profile/quantity-format";
import {
  VIRTUAL_AXIS_IDS,
  formatDurationSeconds,
  formatTime,
  type ControlledObject,
} from "../timeline/timeline-data";
import { useActionBuilder } from "../use-action-builder";
import { getVirtualAxisCanonicalUnit } from "../virtual-axis-display";
import { virtualAxisLabel } from "../virtual-axis-edit";
import { RepairBand } from "./repair-band";

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

const motionNotes = (
  segment: ResolvedMotionSegment,
  motions: Record<VirtualAxisId, ResolvedAxisMotion>,
  formatSpeed: (axis: VirtualAxisId, speed: number) => string,
): Partial<Record<VirtualAxisId, string>> => {
  const notes: Partial<Record<VirtualAxisId, string>> = {};
  for (const axis of VIRTUAL_AXIS_IDS) {
    const motion = motions[axis];
    const parts: string[] = [];
    if (isPassThroughMotion(segment, motion)) {
      parts.push(
        `${virtualAxisLabel(axis)}在区间端点经过，这里是 ${formatTime(motion.startMs)}–` +
          `${formatDurationSeconds(motion.endMs)} 整段曲线，修改作用于整段`,
      );
    }
    if (motion.startSpeed > 0) parts.push(`从 ${formatSpeed(axis, motion.startSpeed)} 进入`);
    if (motion.endSpeed > 0) parts.push(`以 ${formatSpeed(axis, motion.endSpeed)} 离开`);
    if (parts.length > 0) notes[axis] = parts.join("；");
  }
  return notes;
};

/** 一个运动区间的曲线编辑：速度图、阶段（按时间 / 按速度）和运动结果 */
export const SegmentEditor = ({
  sequence,
  segment,
  onUpdateSegment,
}: {
  sequence: ActionSequenceConfig;
  segment: ResolvedMotionSegment;
  onUpdateSegment: (fromRef: string, toRef: string, settings: MotionSegmentSettings) => void;
}) => {
  const { getTimelineObject, sequenceIssues, phaseInputMode, handlePhaseInputModeChange } =
    useActionBuilder();
  const display = useSessionDisplayLengthUnit();
  const object = getTimelineObject(segment.objectId);
  const { motions, profiles, axisContext } = segmentEditContext(segment, object);
  const formatAxisSpeed = (axis: VirtualAxisId, speed: number) =>
    formatQuantity(speed, `${getVirtualAxisCanonicalUnit(axis, object?.controlType)}/s`, display);
  const configProfiles = (fromRef: string, toRef: string, durationMs: number) =>
    sequence.segments.find((item) => item.fromRef === fromRef && item.toRef === toRef)?.settings
      .profiles ?? createDefaultAxisProfiles(durationMs);
  // 编辑器一次只改一个轴；跨过端点的轴写到它整段曲线的设置上
  const handleProfilesChange = (next: AxisMotionProfiles) => {
    for (const axis of VIRTUAL_AXIS_IDS) {
      if (next[axis] === profiles[axis]) continue;
      const motion = motions[axis];
      const base = configProfiles(motion.fromRef, motion.toRef, motion.durationMs);
      onUpdateSegment(motion.fromRef, motion.toRef, { profiles: { ...base, [axis]: next[axis] } });
    }
  };
  return (
    <>
      <RepairBand
        items={formatRepairItems(sequenceIssues ?? [], { segmentKey: segment.key }, {
          objectName: (id) => getTimelineObject(id)?.name,
        })}
      />
      <MotionProfileEditor
        key={`${segment.fromRef}->${segment.toRef}`}
        value={profiles}
        disabled={!segment.configurable}
        axisContext={axisContext}
        axisNotes={motionNotes(segment, motions, formatAxisSpeed)}
        segmentContext={{
          fromRef: segment.fromRef,
          toRef: segment.toRef,
        }}
        phaseInputMode={phaseInputMode}
        onPhaseInputModeChange={handlePhaseInputModeChange}
        onChange={handleProfilesChange}
      />
    </>
  );
};
