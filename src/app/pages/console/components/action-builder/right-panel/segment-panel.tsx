import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CollapsePanel } from "@/app/components/ics/collapse-panel";
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
import {
  RAMP_PRESETS,
  presetRate,
  rampPresetOf,
  referencePlan,
  withRampPreset,
  type RampPreset,
  type ReferenceKind,
} from "../motion-profile/segment-presets";
import { TrapezoidProfileEditor } from "../motion-profile/trapezoid-profile-editor";
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
import {
  endJunctionView,
  withAxisPassSpeed,
  withEndStop,
  type EndJunctionView,
  type SegmentEnd,
} from "./segment-junctions";

const axisName = (axis: VirtualAxisId): string => axis.toUpperCase();

const END_LABEL: Record<SegmentEnd, string> = { start: "起点", end: "终点" };
const STOP_LABEL: Record<SegmentEnd, string> = { start: "停稳再走", end: "停在这里" };
const GO_LABEL: Record<SegmentEnd, string> = { start: "接上一段", end: "接下一段" };

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

/** 一排互斥按钮：停不停、起步收尾的档位 */
const Segmented = <T extends string>({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T | null;
  disabled?: boolean;
  onChange: (id: T) => void;
}) => (
  <div role="group" aria-label={label} className="flex overflow-hidden rounded-md bg-input-background">
    {options.map((option) => {
      const pressed = option.id === value;
      return (
        <button
          key={option.id}
          type="button"
          aria-pressed={pressed}
          disabled={disabled}
          onClick={() => onChange(option.id)}
          className={`h-8 min-w-0 flex-1 truncate px-1 text-body-sm disabled:opacity-50 ${touchHeight} ${
            pressed ? "bg-accent font-semibold text-primary" : "text-foreground hover:bg-accent"
          }`}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

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
 * 一个运动区间：时长和参考时长、各轴「起点 » 终点」、速度曲线、两头停不停和起步收尾的档位；
 * 变速时间、加减速度这些数值收在「精确设置」里。
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
    segmentDetailsOpen,
    handleSegmentDetailsOpenChange,
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
  // 测试里没有挂动作页的上下文时，展开状态只记在这一个面板里
  const [localDetailsOpen, setLocalDetailsOpen] = useState(false);
  const detailsOpen = segmentDetailsOpen ?? localDetailsOpen;
  const setDetailsOpen = handleSegmentDetailsOpenChange ?? setLocalDetailsOpen;

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

  // 这段自己的、在动的轴：起步收尾的档位、参考时长和改时长都只管它们
  const rampAxes = segmentRampAxes(segment, object);
  const movingAxes = enabledAxes.filter((axis) => motions[axis].to !== motions[axis].from);

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

  /** 这段自己的几个轴一起换曲线（一步撤销） */
  const writeOwnProfiles = (next: Map<VirtualAxisId, MotionProfile>) => {
    const profilesNext = { ...configProfiles(segment.fromRef, segment.toRef, segment.durationMs) };
    next.forEach((profile, axis) => {
      profilesNext[axis] = profile;
    });
    onUpdateSegment(segment.fromRef, segment.toRef, { profiles: profilesNext });
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

  // 起步收尾一起按档：各轴两头都在同一档才算这一档
  const rampPreset = ((): RampPreset | null => {
    const found = rampAxes.map((axis) => rampPresetOf(axis));
    const first = found[0] ?? null;
    return first !== null && found.every((preset) => preset === first) ? first : null;
  })();
  const presetsAvailable = rampAxes.length > 0 && rampAxes.every((axis) => presetRate(axis.limits, "standard") !== null);

  const applyRampPreset = (preset: RampPreset) => {
    const label = RAMP_PRESETS.find((item) => item.id === preset)?.label ?? preset;
    const next = new Map<VirtualAxisId, MotionProfile>();
    for (const axis of rampAxes) {
      const profile = withRampPreset(axis, preset);
      if (!profile) {
        toast.warning(`${axisName(axis.axis)} 这段时间放不下「${label}」，把时长改长或换一档`);
        return;
      }
      next.set(axis.axis, profile);
    }
    writeOwnProfiles(next);
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

  const junctionOf = (end: SegmentEnd): EndJunctionView => endJunctionView(ends[end].point, movingAxes, end);

  const renderPassSpeed = (end: SegmentEnd, view: EndJunctionView) => {
    const { block, point } = ends[end];
    if (view.kind !== "choice" || !view.axes.includes(currentAxis) || block?.kind !== "pose") return null;
    const junction = point?.junctions?.[currentAxis];
    if (!junction || junction.speed === 0) return null;
    const label = `${axisName(currentAxis)} ${END_LABEL[end]}经过速度`;
    return (
      <div className="flex flex-col gap-1">
        <p className="flex items-center justify-between gap-1 text-body-sm text-muted-foreground">
          <span className="truncate">{axisName(currentAxis)} 经过速度</span>
          {junction.kind === "manual" ? (
            <button
              type="button"
              aria-label={`${label}改回自动`}
              disabled={readOnly}
              onClick={() => onReplaceBlock(withAxisPassSpeed(block, currentAxis, null))}
              className="shrink-0 rounded-sm px-1 text-body-sm text-primary hover:bg-accent"
            >
              改回自动
            </button>
          ) : (
            <span className="shrink-0">自动</span>
          )}
        </p>
        <UnitAwareNumericInput
          aria-label={label}
          value={roundProjectCoordinate(junction.speed)}
          unit={speedUnit}
          min={0}
          step={1}
          precision={1}
          disabled={readOnly}
          onCommit={(value) =>
            onReplaceBlock(withAxisPassSpeed(block, currentAxis, roundProjectCoordinate(Math.max(0, value))))
          }
          className="w-full border border-border"
        />
      </div>
    );
  };

  const renderEndColumn = (end: SegmentEnd) => {
    const view = junctionOf(end);
    const { block, atMs } = ends[end];
    return (
      <div role="group" aria-label={END_LABEL[end]} className="flex min-w-0 flex-col gap-1.5 rounded-md bg-muted p-2">
        <p className="flex items-baseline justify-between gap-1 text-body-sm text-muted-foreground">
          <span>{END_LABEL[end]}</span>
          <span className="font-mono text-mono-sm tabular-nums">{formatTime(atMs)} s</span>
        </p>
        {view.kind === "choice" && block?.kind === "pose" ? (
          <Segmented
            label={`${END_LABEL[end]}停不停`}
            options={[
              { id: "stop", label: STOP_LABEL[end] },
              { id: "go", label: GO_LABEL[end] },
            ]}
            value={view.stop === true ? "stop" : view.stop === false ? "go" : null}
            disabled={readOnly}
            onChange={(id) => onReplaceBlock(withEndStop(block, view.axes, id === "stop"))}
          />
        ) : null}
        {view.kind === "choice" && view.stop === "mixed" ? (
          <p className="text-body-sm text-muted-foreground">各轴不一样</p>
        ) : null}
        {view.kind === "fixed" ? <p className="text-body-sm text-foreground">{view.text}</p> : null}
        {renderPassSpeed(end, view)}
      </div>
    );
  };

  // 看的那根轴现在的起步、收尾时间（不在档上时显示）
  const rampProfile = (rampAxes.find((axis) => axis.axis === currentAxis) ?? rampAxes[0])?.profile;
  const rampTimes =
    rampProfile?.kind === "trapezoid"
      ? `现在 起步 ${formatTime(rampProfile.params.accelMs)} s · 收尾 ${formatTime(rampProfile.params.decelMs)} s`
      : null;

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

      {rampAxes.length > 0 ? (
        <section aria-label="起步收尾" className="rounded-md bg-muted p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-body-sm text-muted-foreground">起步收尾</span>
            <div className="w-44 shrink-0">
              <Segmented
                label="起步收尾"
                options={RAMP_PRESETS}
                value={rampPreset}
                disabled={readOnly || !presetsAvailable}
                onChange={applyRampPreset}
              />
            </div>
          </div>
          {!presetsAvailable ? (
            <p className="mt-1 text-body-sm text-muted-foreground">搭建里没设加速度，没有档位</p>
          ) : rampPreset === null && rampTimes ? (
            // 不在档上（新建区间默认按时长的两成变速，或两头不一样）：说现在是多久，不说「自定义」
            <p className="mt-1 text-body-sm text-muted-foreground">{rampTimes}</p>
          ) : null}
        </section>
      ) : null}

      <section aria-label="起点和终点怎么走" className="grid grid-cols-2 gap-2">
        {renderEndColumn("start")}
        {renderEndColumn("end")}
      </section>

      <CollapsePanel
        title="精确设置"
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        contentClassName="flex flex-col gap-2 bg-background p-0 pt-2"
      >
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
      </CollapsePanel>
    </div>
  );
};
