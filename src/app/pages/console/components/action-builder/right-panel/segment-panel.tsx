import { useMemo, useState } from "react";
import { toast } from "sonner";
import { clampNumeric } from "@/app/components/ics/numeric-input-utils";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { isAxisSet } from "@/app/project/action-sequence/keyframe-pose";
import {
  boundaryTrapezoidOf,
  boundaryTrapezoidSpeedAt,
  createDefaultAxisProfiles,
  hasMotionBoundary,
} from "@/app/project/action-sequence/motion-profile";
import { formatRepairItems } from "@/app/project/action-sequence/preset-repair";
import {
  isPassThroughMotion,
  uncontrolledAxesOf,
  type PoseJunctionKind,
  type ResolvedActionSequence,
  type ResolvedMotionSegment,
  type ResolvedPosePoint,
} from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  ModelPose,
  MotionProfile,
  MotionSegmentSettings,
  PoseBlock,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import { getDisplayLengthFamilyUnit } from "@/app/project/display-length-units";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { roundProjectCoordinate } from "@/app/project/project-quantity";
import { PhaseInputModeTabs } from "../motion-profile/motion-profile-editor";
import {
  axisDurationMs,
  axisHasWarning,
  maxAccelerationOf,
  profileLimitWarnings,
  resolveEnabledAxes,
  tryKinematics,
} from "../motion-profile/motion-profile-status";
import { profileKindMeta } from "../motion-profile/profile-kind";
import { formatQuantity, formatQuantityValue } from "../motion-profile/quantity-format";
import { referencePlan, type ReferenceKind } from "../motion-profile/segment-presets";
import { TrapezoidProfileEditor, type FlatEnd } from "../motion-profile/trapezoid-profile-editor";
import { VelocityChart } from "../motion-profile/velocity-chart";
import type { SegmentRetimeWrite } from "../sequence-ops";
import {
  VIRTUAL_AXIS_IDS,
  formatDurationSeconds,
  formatTime,
  msToSeconds,
  secondsToMs,
} from "../timeline/timeline-data";
import { useActionBuilder } from "../use-action-builder";
import { getVirtualAxisCanonicalUnit } from "../virtual-axis-display";
import { virtualAxisStep } from "../virtual-axis-edit";
import { RepairBand } from "./repair-band";
import { segmentEditContext } from "./segment-editor";
import { segmentDurationWrites, segmentRampAxes } from "./segment-retime";

const axisName = (axis: VirtualAxisId): string => axis.toUpperCase();

type SegmentEnd = "start" | "end";
const END_LABEL: Record<SegmentEnd, string> = { start: "起点", end: "终点" };

/** 这一帧必须停的原因：段首、段尾变速不能填 0 */
const STOP_REASON: Partial<Record<PoseJunctionKind, string>> = {
  edge: "是序列的起止",
  reverse: "处折返",
  hold: "前后有一段不动",
};

const REFERENCES: ReadonlyArray<{ kind: ReferenceKind; label: string }> = [
  { kind: "fastest", label: "最快" },
  { kind: "default", label: "默认速度" },
];

const touchHeight = "[@media(pointer:coarse)]:h-10";

/** 行程最大的轴先看 */
const pickDefaultAxis = (axes: readonly VirtualAxisId[], travel: Pick<ModelPose, VirtualAxisId>) => {
  let selected: VirtualAxisId = axes[0] ?? "v1";
  let best = Number.NEGATIVE_INFINITY;
  for (const axis of VIRTUAL_AXIS_IDS) {
    if (!axes.includes(axis)) continue;
    const abs = Math.abs(travel[axis] ?? 0);
    if (abs > best) {
      selected = axis;
      best = abs;
    }
  }
  return selected;
};

const MetricTile = ({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) => (
  <div className="min-w-0 rounded-md bg-input-background px-2 py-2">
    <p className="text-body-sm text-muted-foreground">{label}</p>
    <p
      aria-label={label}
      aria-readonly="true"
      className={`mt-0.5 truncate font-mono text-mono-sm tabular-nums ${warning ? "text-warning" : "text-foreground"}`}
    >
      {value}
    </p>
  </div>
);

/**
 * 一个运动区间：时长和参考时长、各轴「起点 » 终点」、速度曲线，下面直接是看的那根轴的阶段和运动结果。
 */
export const SegmentPanel = ({
  sequence,
  resolved,
  segment,
  onReplaceBlock,
  onUpdateSegment,
}: {
  sequence: ActionSequenceConfig;
  resolved: ResolvedActionSequence;
  segment: ResolvedMotionSegment;
  onReplaceBlock: (block: TimelineBlock) => void;
  onUpdateSegment: (fromRef: string, toRef: string, settings: MotionSegmentSettings) => void;
}) => {
  const {
    getTimelineObject,
    getLivePose,
    sequenceIssues,
    phaseInputMode,
    handlePhaseInputModeChange,
    handleRetimeSegmentCurves,
    handleSetPassSpeedMode,
  } = useActionBuilder();
  const display = useSessionDisplayLengthUnit();
  const object = getTimelineObject(segment.objectId);
  const { motions, profiles, axisContext } = segmentEditContext(segment, object);
  const enabledAxes = resolveEnabledAxes(axisContext.enabledAxes);
  const readOnly = !segment.configurable;
  const [selectedAxis, setSelectedAxis] = useState<VirtualAxisId>(() =>
    pickDefaultAxis(enabledAxes, axisContext.travel),
  );
  const currentAxis = enabledAxes.includes(selectedAxis)
    ? selectedAxis
    : pickDefaultAxis(enabledAxes, axisContext.travel);

  const pointOf = (ref: string) => resolved.poses.find((point) => point.sourceRef === ref);
  const blockOf = (point: ResolvedPosePoint | undefined) =>
    point?.sourceBlockId ? sequence.blocks.find((block) => block.id === point.sourceBlockId) : undefined;
  const ends: Record<SegmentEnd, { point?: ResolvedPosePoint; block?: TimelineBlock; atMs: number }> = {
    start: { point: pointOf(segment.fromRef), atMs: segment.startMs },
    end: { point: pointOf(segment.toRef), atMs: segment.endMs },
  };
  ends.start.block = blockOf(ends.start.point);
  ends.end.block = blockOf(ends.end.point);
  const uncontrolled = uncontrolledAxesOf(resolved, segment.objectId);

  // 这段自己的、在动的轴：参考时长和改时长都只管它们
  const rampAxes = segmentRampAxes(segment, object);

  const plans = useMemo(
    () =>
      REFERENCES.flatMap(({ kind, label }) => {
        const plan = referencePlan(rampAxes, kind);
        return plan ? [{ kind, label, plan }] : [];
      }),
    // rampAxes 由 segment 和物体的上限算出来，播放、拖游标时不重算
    [segment, object],
  );

  const configProfiles = (fromRef: string, toRef: string, durationMs: number) =>
    sequence.segments.find((item) => item.fromRef === fromRef && item.toRef === toRef)?.settings
      .profiles ?? createDefaultAxisProfiles(durationMs);

  /** 一个轴的曲线：跨过端点的轴写到它整段曲线上 */
  const writeAxisProfile = (axis: VirtualAxisId, profile: MotionProfile) => {
    const motion = motions[axis];
    const base = configProfiles(motion.fromRef, motion.toRef, motion.durationMs);
    onUpdateSegment(motion.fromRef, motion.toRef, { profiles: { ...base, [axis]: profile } });
  };

  /** 改这段的时长：终点和这个物体后面的块一起挪，各轴换成给的曲线 */
  const retimeSegment = (durationMs: number, next: Map<VirtualAxisId, MotionProfile>) => {
    const axes = next.size > 0 ? [...next.keys()] : [currentAxis];
    const writes: SegmentRetimeWrite[] = axes.map((axis) => ({
      objectId: segment.objectId,
      fromRef: segment.fromRef,
      toRef: segment.toRef,
      axis,
      profile: next.get(axis) ?? configProfiles(segment.fromRef, segment.toRef, segment.durationMs)[axis],
      durationMs,
    }));
    handleRetimeSegmentCurves(writes);
  };

  const handleDurationCommit = (nextMs: number) => {
    if (!(nextMs > 0) || nextMs === segment.durationMs) return;
    handleRetimeSegmentCurves(segmentDurationWrites(segment, object, nextMs));
  };

  /** 按速度改一个轴：这一轴整段曲线换时长 */
  const retimeAxis = (axis: VirtualAxisId, profile: MotionProfile, durationMs: number) => {
    const motion = motions[axis];
    handleRetimeSegmentCurves([
      { objectId: segment.objectId, fromRef: motion.fromRef, toRef: motion.toRef, axis, profile, durationMs },
    ]);
  };

  const applyReference = (plan: { durationMs: number; profiles: Map<VirtualAxisId, MotionProfile> }) => {
    retimeSegment(plan.durationMs, plan.profiles);
  };

  // 当前轴的曲线和提示（和原来的区间编辑器一样）
  const currentProfile = profiles[currentAxis];
  const currentDurationMs = axisDurationMs(axisContext, currentAxis);
  const unit = getVirtualAxisCanonicalUnit(currentAxis, axisContext.controlType);
  const speedUnit = `${unit}/s`;
  const accelUnit = `${unit}/s²`;
  const travelDistance = Math.abs(axisContext.travel[currentAxis] ?? 0);
  const displayProfile: MotionProfile =
    travelDistance === 0 || currentProfile.kind === "idle" ? { kind: "idle" } : currentProfile;
  const currentBoundary = axisContext.boundaryByAxis?.[currentAxis];
  const withPassSpeeds = hasMotionBoundary(currentBoundary);
  const kinematics = tryKinematics(displayProfile, travelDistance, currentDurationMs, currentBoundary);
  const boundaryShape =
    travelDistance > 0 && currentBoundary && withPassSpeeds
      ? boundaryTrapezoidOf(displayProfile, travelDistance, currentDurationMs, currentBoundary)
      : null;
  const maxSpeed = axisContext.maxSpeedByAxis?.[currentAxis];
  const overSpeed = maxSpeed !== undefined && kinematics !== null && kinematics.peakVelocity > maxSpeed;
  const warnings = [
    ...profileLimitWarnings(
      displayProfile,
      currentDurationMs,
      kinematics,
      maxAccelerationOf(currentAxis, axisContext),
      (value) => formatQuantity(value, accelUnit, display),
    ),
    ...(travelDistance > 0 && withPassSpeeds && !boundaryShape
      ? ["经过速度太快，这段行程放不下进出变速"]
      : []),
  ];
  const currentMotion = motions[currentAxis];

  // 段首 / 段尾不变速：起点跟后段、终点跟前段（经过速度等于这段的匀速）。跨端点的轴按整段曲线的两头算
  const motionEnds: Record<FlatEnd, ResolvedPosePoint | undefined> = {
    start: pointOf(currentMotion.fromRef),
    end: pointOf(currentMotion.toRef),
  };
  const flatEnds = {
    start: motionEnds.start?.junctions?.[currentAxis]?.kind === "follow-next",
    end: motionEnds.end?.junctions?.[currentAxis]?.kind === "follow-prev",
  };
  const handleFlatEndChange = (end: FlatEnd, flat: boolean, nextProfile?: MotionProfile) => {
    const point = motionEnds[end];
    const where = end === "start" ? "起点" : "终点";
    const phase = end === "start" ? "段首变速" : "段尾变速";
    const blockId = point?.sourceKind === "pose" ? point.sourceBlockId : null;
    if (!blockId) {
      if (flat) toast.warning(`${where}是预设生成的，${phase}不能为 0，拆解预设后再改`);
      return;
    }
    const reason = STOP_REASON[point?.junctions?.[currentAxis]?.kind ?? "edge"];
    if (flat && reason) {
      toast.warning(`${where}${reason}，必须停在这一帧，${phase}不能为 0`);
      return;
    }
    handleSetPassSpeedMode(
      blockId,
      currentAxis,
      flat ? (end === "start" ? "next" : "prev") : null,
      nextProfile
        ? {
            fromRef: currentMotion.fromRef,
            toRef: currentMotion.toRef,
            axis: currentAxis,
            profile: nextProfile,
            durationMs: currentMotion.durationMs,
          }
        : undefined,
    );
  };

  const passNote = isPassThroughMotion(segment, currentMotion)
    ? `${axisName(currentAxis)} 在区间端点经过，曲线是 ${formatTime(currentMotion.startMs)}–${formatDurationSeconds(currentMotion.endMs)} 整段的，改动作用于整段`
    : null;
  // 「最快」按两头都停来算（加减速是「快」档），只在两头都停的段上提示比它短；超没超上限看校验
  const fastest = plans.find((item) => item.kind === "fastest")?.plan.durationMs;
  const stopsAtBothEnds = rampAxes.every(
    (axis) => !(axis.boundary?.startSpeed ?? 0) && !(axis.boundary?.endSpeed ?? 0),
  );
  const tooShort = fastest !== undefined && stopsAtBothEnds && segment.durationMs < fastest;

  const commitAxisValue = (block: PoseBlock, axis: VirtualAxisId, value: number) => {
    setSelectedAxis(axis);
    const range = object?.rangeByAxis?.[axis];
    const clamped = clampNumeric(value, range?.min, range?.max);
    if (block.pose[axis] === clamped) return;
    onReplaceBlock({ ...block, pose: { ...block.pose, [axis]: clamped } });
  };

  /** 把经过的轴在这一头设成值：取这一帧的经过值；序列不控制的轴取实时位置 */
  const setAxisValue = (block: PoseBlock, point: ResolvedPosePoint | undefined, axis: VirtualAxisId) => {
    setSelectedAxis(axis);
    const value = uncontrolled.includes(axis)
      ? (getLivePose?.(segment.objectId)?.[axis] ?? point?.pose[axis] ?? 0)
      : (point?.pose[axis] ?? 0);
    onReplaceBlock({ ...block, pose: { ...block.pose, [axis]: roundProjectCoordinate(value) } });
  };

  const renderEndValue = (axis: VirtualAxisId, end: SegmentEnd) => {
    const { block, point } = ends[end];
    const label = `${axisName(axis)} ${END_LABEL[end]}`;
    const axisUnit = getVirtualAxisCanonicalUnit(axis, axisContext.controlType);
    if (block?.kind !== "pose") {
      const value = point?.pose[axis];
      return (
        <span
          aria-label={label}
          className="truncate px-2 text-right font-mono text-mono-sm tabular-nums text-muted-foreground"
        >
          {value === undefined ? "—" : formatQuantity(value, axisUnit, display)}
        </span>
      );
    }
    if (!isAxisSet(block.pose, axis)) {
      const text = uncontrolled.includes(axis) ? "不控制" : "经过";
      return (
        <button
          type="button"
          aria-label={`${label}${text}，点一下设定`}
          disabled={readOnly}
          onClick={() => setAxisValue(block, point, axis)}
          className={`h-8 rounded-md bg-input-background px-2 text-body-sm text-muted-foreground hover:bg-accent disabled:opacity-50 ${touchHeight}`}
        >
          {text}
        </button>
      );
    }
    const range = object?.rangeByAxis?.[axis];
    return (
      <UnitAwareNumericInput
        aria-label={label}
        value={block.pose[axis] ?? 0}
        unit={axisUnit}
        step={virtualAxisStep(axis)}
        precision={1}
        min={range?.min}
        max={range?.max}
        disabled={readOnly}
        onCommit={(value) => commitAxisValue(block, axis, value)}
        className="w-full border border-border"
      />
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <RepairBand
        items={formatRepairItems(sequenceIssues ?? [], { segmentKey: segment.key }, {
          objectName: (id) => getTimelineObject(id)?.name,
        })}
      />

      <section aria-label="区间时长" className="rounded-md bg-muted p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-mono text-mono-sm tabular-nums text-muted-foreground">
            {formatTime(segment.startMs)} → {formatTime(segment.endMs)} s
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-body-sm text-muted-foreground">时长</span>
            <UnitAwareNumericInput
              aria-label="时长"
              value={msToSeconds(segment.durationMs)}
              unit="s"
              step={0.1}
              precision={1}
              min={0.1}
              readOnly={readOnly}
              onCommit={(seconds) => handleDurationCommit(secondsToMs(seconds))}
              className="w-24 border border-border"
            />
          </div>
        </div>
        {plans.length > 0 ? (
          <div role="group" aria-label="参考时长" className="mt-2 flex gap-2">
            {plans.map(({ kind, label, plan }) => {
              const pressed = plan.durationMs === segment.durationMs;
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={pressed}
                  aria-label={`${label} ${formatDurationSeconds(plan.durationMs)}`}
                  disabled={readOnly}
                  onClick={() => applyReference(plan)}
                  className={`h-8 min-w-0 flex-1 truncate rounded-md px-2 text-body-sm disabled:opacity-50 ${touchHeight} ${
                    pressed ? "bg-accent text-primary" : "bg-input-background text-foreground hover:bg-accent"
                  }`}
                >
                  {label} <span className="font-mono tabular-nums">{formatDurationSeconds(plan.durationMs)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {tooShort ? (
          <p className="mt-1 text-body-sm text-warning">比「最快」还短</p>
        ) : null}
      </section>

      <section aria-label="各轴起点和终点" className="flex flex-col gap-0.5 rounded-md bg-muted p-1.5">
        {enabledAxes.map((axis) => {
          const pressed = axis === currentAxis;
          const warning = axisHasWarning(axis, profiles, axisContext);
          const still = segment.fromPose[axis] === segment.toPose[axis];
          return (
            <div
              key={axis}
              className={`grid grid-cols-[2.5rem_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 rounded-md px-1 py-1 ${
                pressed ? "bg-accent" : ""
              }`}
            >
              <button
                type="button"
                aria-pressed={pressed}
                aria-label={`看 ${axisName(axis)} 的曲线`}
                onClick={() => setSelectedAxis(axis)}
                className={`h-8 rounded-sm text-left text-body-sm font-semibold ${touchHeight} ${
                  pressed ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {axisName(axis)}
                {warning ? <span className="ml-0.5 text-warning">●</span> : null}
              </button>
              {renderEndValue(axis, "start")}
              <span className="px-0.5 text-center text-body-sm text-muted-foreground">{still ? "不动" : "»"}</span>
              {renderEndValue(axis, "end")}
            </div>
          );
        })}
      </section>

      {passNote ? <p className="px-1 text-body-sm text-muted-foreground">{passNote}</p> : null}

      <div className="h-40 overflow-visible">
        <VelocityChart
          profile={displayProfile}
          durationMs={currentDurationMs}
          velocityUnit={getDisplayLengthFamilyUnit(speedUnit, display)}
          formatVelocity={(speed) => formatQuantityValue(speed, speedUnit, display)}
          limits={
            travelDistance > 0 && kinematics
              ? { peakVelocity: kinematics.peakVelocity, maxVelocity: maxSpeed }
              : undefined
          }
          disabled={readOnly || displayProfile.kind === "idle"}
          compact
          velocityAt={
            boundaryShape
              ? (tNorm) => boundaryTrapezoidSpeedAt(boundaryShape, (tNorm * currentDurationMs) / 1000)
              : undefined
          }
          onProfileChange={
            displayProfile.kind === "idle" ? undefined : (profile) => writeAxisProfile(currentAxis, profile)
          }
        />
      </div>

      {warnings.length > 0 || overSpeed ? (
        <div className="rounded-md bg-warning-surface px-3 py-2" role="status">
          {overSpeed && maxSpeed !== undefined ? (
            <p className="text-body-sm text-warning">
              {axisName(currentAxis)} 峰值速度超过上限 {formatQuantity(maxSpeed, speedUnit, display)}
            </p>
          ) : null}
          {warnings.map((message) => (
            <p key={message} className="text-body-sm text-warning">
              {message}
            </p>
          ))}
        </div>
      ) : null}

        <section className="rounded-md bg-muted p-3" aria-label="阶段">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-label-caps text-muted-foreground">{axisName(currentAxis)} 阶段</h3>
            <PhaseInputModeTabs mode={phaseInputMode} onChange={handlePhaseInputModeChange} />
          </div>
          {profileKindMeta(displayProfile.kind) ? (
            <TrapezoidProfileEditor
              value={displayProfile}
              onChange={(profile) => writeAxisProfile(currentAxis, profile)}
              durationMs={currentDurationMs}
              disabled={readOnly}
              compact
              showKindSelect={false}
              timeUnit="s"
              readOnly={displayProfile.kind === "idle"}
              withPassSpeeds={withPassSpeeds}
              inputMode={phaseInputMode}
              rateContext={{ distance: travelDistance, boundary: currentBoundary, unit }}
              onRetime={(profile, nextDurationMs) => retimeAxis(currentAxis, profile, nextDurationMs)}
              flatEnds={flatEnds}
              onFlatEndChange={readOnly || displayProfile.kind === "idle" ? undefined : handleFlatEndChange}
            />
          ) : (
            <p className="text-body-sm text-muted-foreground">未知曲线</p>
          )}
        </section>
        <section className="rounded-md bg-muted p-3" aria-label={`${axisName(currentAxis)} 运动结果`}>
          <h3 className="mb-2 text-label-caps text-muted-foreground">{axisName(currentAxis)} 运动结果</h3>
          <div className="grid grid-cols-2 gap-1.5">
            <MetricTile
              label="峰值速度"
              value={kinematics ? formatQuantity(kinematics.peakVelocity, speedUnit, display) : "—"}
              warning={overSpeed}
            />
            <MetricTile
              label="速度上限"
              value={maxSpeed === undefined ? "未配置" : formatQuantity(maxSpeed, speedUnit, display)}
            />
            <MetricTile
              label="加速度"
              value={kinematics ? formatQuantity(kinematics.acceleration, accelUnit, display) : "—"}
            />
            <MetricTile
              label="减速度"
              value={kinematics ? formatQuantity(kinematics.deceleration, accelUnit, display) : "—"}
            />
          </div>
        </section>
    </div>
  );
};
