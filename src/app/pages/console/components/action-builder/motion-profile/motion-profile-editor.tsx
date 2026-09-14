import { useState } from "react";
import { cn } from "@/app/components/ui/utils";
import type { MotionProfileKinematics } from "@/app/project/action-sequence/motion-profile";
import type { AxisMotionProfiles, ModelPose, MotionProfile } from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { roundProjectCoordinate } from "@/app/project/project-quantity";
import { VIRTUAL_AXIS_IDS, formatTime } from "../timeline/timeline-data";
import { getVirtualAxisCanonicalUnit } from "../virtual-axis-display";
import { PROFILE_KIND_OPTIONS, profileKindMeta } from "./profile-kind";
import {
  axisHasWarning,
  minAccelMsOf,
  phaseFloorWarningMessages,
  resolveEnabledAxes,
  tryKinematics,
  type MotionProfileAxisContext,
} from "./motion-profile-status";
import { TrapezoidProfileEditor } from "./trapezoid-profile-editor";
import { VelocityChart, type VelocityChartLimits } from "./velocity-chart";

export type { MotionProfileAxisContext };

export type MotionProfileEditorProps = {
  value: AxisMotionProfiles;
  onChange: (profiles: AxisMotionProfiles) => void;
  disabled?: boolean;
  compact?: boolean;
  axisContext?: MotionProfileAxisContext;
  segmentContext?: {
    fromRef: string;
    toRef: string;
  };
};

const formatNumber = (value: number): string => {
  const rounded = roundProjectCoordinate(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const axisName = (axis: VirtualAxisId): string => axis.toUpperCase();

const formatDurationSec = (durationMs: number): string => `${formatTime(durationMs)} s`;

const formatTravel = (value: number, unit: string): string => {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value)} ${unit}`;
};

const pickDefaultAxis = (
  axes: readonly VirtualAxisId[],
  travel: Pick<ModelPose, VirtualAxisId>,
): VirtualAxisId => {
  const allowed = new Set(axes);
  let selected: VirtualAxisId = axes[0] ?? "v1";
  let best = Number.NEGATIVE_INFINITY;
  for (const axis of VIRTUAL_AXIS_IDS) {
    if (!allowed.has(axis)) continue;
    const abs = Math.abs(travel[axis] ?? 0);
    if (abs > best) {
      selected = axis;
      best = abs;
    }
  }
  return selected;
};

const toChartLimits = (
  kinematics: MotionProfileKinematics,
  axis: VirtualAxisId,
  axisContext: MotionProfileAxisContext,
): VelocityChartLimits => ({
  peakVelocity: kinematics.peakVelocity,
  maxVelocity: axisContext.maxSpeedByAxis?.[axis],
});

const OverLimitWarning = ({ max }: { max: number }) => (
  <p className="text-body-sm text-warning">超过上限 {formatNumber(max)}</p>
);

const PhaseFloorWarnings = ({
  profile,
  durationMs,
  minAccelMs,
}: {
  profile: MotionProfile;
  durationMs: number;
  minAccelMs: number | undefined;
}) => {
  const warnings = phaseFloorWarningMessages(profile, durationMs, minAccelMs);
  if (warnings.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {warnings.map((message) => (
        <p key={message} className="text-body-sm text-warning">
          {message}
        </p>
      ))}
    </div>
  );
};

const MetricReadout = ({
  label,
  value,
  unit,
  max,
  actual,
}: {
  label: string;
  value: number;
  unit: string;
  max?: number;
  actual: number | undefined;
}) => (
  <div className="flex flex-col gap-1">
    <p className="text-body-sm text-muted-foreground">{label}</p>
    <p
      aria-label={label}
      aria-readonly="true"
      className="rounded-md bg-input-background px-3 py-2 font-mono text-mono-sm tabular-nums text-foreground"
    >
      {formatNumber(value)} {unit}
    </p>
    {max !== undefined && actual !== undefined && actual > max ? (
      <OverLimitWarning max={max} />
    ) : null}
  </div>
);

const AxisMetrics = ({
  axis,
  profile,
  axisContext,
}: {
  axis: VirtualAxisId;
  profile: MotionProfile;
  axisContext: MotionProfileAxisContext;
}) => {
  const unit = getVirtualAxisCanonicalUnit(axis, axisContext.controlType);
  const kinematics = tryKinematics(
    profile,
    Math.abs(axisContext.travel[axis] ?? 0),
    axisContext.durationMs,
  );

  return (
    <div className="flex flex-col gap-2">
      <MetricReadout
        label="峰值速度"
        value={kinematics?.peakVelocity ?? 0}
        unit={`${unit}/s`}
        max={axisContext.maxSpeedByAxis?.[axis]}
        actual={kinematics?.peakVelocity}
      />
      <MetricReadout
        label="加速度"
        value={kinematics?.acceleration ?? 0}
        unit={`${unit}/s²`}
        actual={kinematics?.acceleration}
      />
      <MetricReadout
        label="减速度"
        value={kinematics?.deceleration ?? 0}
        unit={`${unit}/s²`}
        actual={kinematics?.deceleration}
      />
    </div>
  );
};

const ProfileKindSelect = ({
  profile,
  durationMs,
  minAccelMs,
  disabled,
  inline = false,
  summary = false,
  onChange,
}: {
  profile: MotionProfile;
  durationMs: number;
  minAccelMs?: number;
  disabled: boolean;
  inline?: boolean;
  summary?: boolean;
  onChange: (profile: MotionProfile) => void;
}) => {
  const currentMeta = profileKindMeta(profile.kind);
  const isIdle = profile.kind === "idle";
  const selectedKind =
    currentMeta?.kind ?? PROFILE_KIND_OPTIONS[0]?.kind ?? profile.kind;

  const handleKindChange = (nextKind: string) => {
    const nextMeta = profileKindMeta(nextKind as MotionProfile["kind"]);
    if (!nextMeta || nextMeta.kind === profile.kind) return;
    onChange(nextMeta.createProfile(durationMs, minAccelMs));
  };

  return (
    <label
      className={cn(
        summary
          ? "min-w-0 rounded-md bg-input-background px-2 py-2"
          : inline
            ? "flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2"
            : "flex flex-col gap-1",
      )}
    >
      <span
        className={cn(
          "text-muted-foreground",
          inline && !summary ? "text-label-caps" : "text-body-sm",
        )}
      >
        曲线类型
      </span>
      {isIdle ? (
        <p
          aria-label="曲线类型"
          className={cn(
            "text-foreground",
            summary ? "mt-0.5 h-8 px-2 text-body-sm leading-8" : "text-body-sm",
          )}
        >
          静止
        </p>
      ) : (
        <select
          aria-label="曲线类型"
          value={selectedKind}
          disabled={disabled}
          onChange={(event) => handleKindChange(event.currentTarget.value)}
          className={cn(
            "rounded-md border border-border/60 bg-input-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring",
            summary
              ? "mt-0.5 h-8 w-full px-2 text-body-sm"
              : inline
                ? "h-8 min-w-28 px-2 text-body-sm"
                : "h-9 px-3 text-body-md",
          )}
        >
          {PROFILE_KIND_OPTIONS.map((option) => (
            <option key={option.kind} value={option.kind}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </label>
  );
};

const SegmentMetricTile = ({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) => (
  <div className="min-w-0 rounded-md bg-input-background px-2 py-2">
    <p className="text-body-sm text-muted-foreground">{label}</p>
    <p
      aria-label={label}
      aria-readonly="true"
      className={cn(
        "mt-0.5 truncate font-mono text-mono-sm tabular-nums",
        warning ? "text-warning" : "text-foreground",
      )}
      title={value}
    >
      {value}
    </p>
  </div>
);

export const MotionProfileEditor = ({
  value,
  onChange,
  disabled = false,
  compact = false,
  axisContext,
  segmentContext,
}: MotionProfileEditorProps) => {
  const enabledAxes = axisContext
    ? resolveEnabledAxes(axisContext.enabledAxes)
    : VIRTUAL_AXIS_IDS;
  const [selectedAxis, setSelectedAxis] = useState<VirtualAxisId>(() =>
    axisContext ? pickDefaultAxis(enabledAxes, axisContext.travel) : "v1",
  );

  const handleAxisClick = (axis: VirtualAxisId) => {
    setSelectedAxis(axis);
  };

  const durationMs = axisContext?.durationMs ?? 0;

  const handleProfileChange = (axis: VirtualAxisId, profile: MotionProfile) => {
    onChange({ ...value, [axis]: profile });
  };

  if (compact || !axisContext) {
    return (
      <TrapezoidProfileEditor
        value={value.v1}
        onChange={(profile) => handleProfileChange("v1", profile)}
        durationMs={durationMs}
        disabled={disabled}
        compact={compact}
        timeUnit="s"
      />
    );
  }

  const currentAxis = enabledAxes.includes(selectedAxis)
    ? selectedAxis
    : pickDefaultAxis(enabledAxes, axisContext.travel);
  const currentProfile = value[currentAxis];
  const otherAxes = enabledAxes.filter((axis) => axis !== currentAxis);
  const unit = getVirtualAxisCanonicalUnit(currentAxis, axisContext.controlType);
  const travelDistance = Math.abs(axisContext.travel[currentAxis] ?? 0);
  const displayProfile: MotionProfile =
    travelDistance === 0 || currentProfile.kind === "idle" ? { kind: "idle" } : currentProfile;
  const kindMeta = profileKindMeta(displayProfile.kind);
  const kinematics = tryKinematics(displayProfile, travelDistance, axisContext.durationMs);
  const limits =
    travelDistance > 0 && kinematics
      ? toChartLimits(kinematics, currentAxis, axisContext)
      : undefined;
  const minAccelMs = minAccelMsOf(currentAxis, axisContext);
  const currentWarnings = phaseFloorWarningMessages(
    displayProfile,
    axisContext.durationMs,
    minAccelMs,
  );
  const currentMaxSpeed = axisContext.maxSpeedByAxis?.[currentAxis];
  const currentOverSpeed =
    currentMaxSpeed !== undefined &&
    kinematics !== null &&
    kinematics.peakVelocity > currentMaxSpeed;

  if (segmentContext) {
    const peakVelocityText = kinematics
      ? `${formatNumber(kinematics.peakVelocity)} ${unit}/s`
      : "—";
    const maxVelocityText =
      currentMaxSpeed === undefined
        ? "未配置"
        : `${formatNumber(currentMaxSpeed)} ${unit}/s`;

    return (
      <div className="flex flex-col gap-2.5">
        <section className="rounded-md bg-muted p-3" aria-label="区间摘要">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <ProfileKindSelect
              profile={displayProfile}
              durationMs={axisContext.durationMs}
              minAccelMs={minAccelMs}
              disabled={disabled || displayProfile.kind === "idle"}
              summary
              onChange={(profile) => handleProfileChange(currentAxis, profile)}
            />
            <div className="min-w-19 rounded-md bg-input-background px-2 py-2">
              <p className="text-body-sm text-muted-foreground">总时长</p>
              <p
                aria-label="时长"
                aria-readonly="true"
                className="mt-0.5 font-mono text-mono-sm tabular-nums text-foreground"
              >
                {formatDurationSec(axisContext.durationMs)}
              </p>
            </div>
          </div>
        </section>

        <div
          className="flex gap-1 rounded-md bg-input-background p-1"
          role="group"
          aria-label="虚拟轴"
        >
          {enabledAxes.map((axis) => {
            const pressed = axis === currentAxis;
            const axisUnit = getVirtualAxisCanonicalUnit(
              axis,
              axisContext.controlType,
            );
            const axisWarning = axisHasWarning(axis, value, axisContext);
            return (
              <button
                key={axis}
                type="button"
                aria-label={`${axisName(axis)} ${formatTravel(axisContext.travel[axis] ?? 0, axisUnit)}`}
                aria-pressed={pressed}
                onClick={() => handleAxisClick(axis)}
                className={cn(
                  "min-w-0 flex-1 rounded-sm border-b-2 px-1 py-1.5 text-center",
                  pressed
                    ? "border-primary bg-accent text-primary"
                    : "border-transparent text-muted-foreground hover:bg-accent",
                )}
              >
                <span className="block text-body-sm font-semibold">
                  {axisName(axis)}
                  {axisWarning ? <span className="ml-1 text-warning">●</span> : null}
                </span>
                <span className="block truncate font-mono text-[10px] leading-3 tabular-nums">
                  {formatTravel(axisContext.travel[axis] ?? 0, axisUnit)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="h-40 overflow-visible">
          <VelocityChart
            profile={displayProfile}
            durationMs={axisContext.durationMs}
            velocityUnit={`${unit}/s`}
            limits={limits}
            disabled={disabled || displayProfile.kind === "idle"}
            compact
            minAccelMs={minAccelMs}
            onProfileChange={
              displayProfile.kind === "idle"
                ? undefined
                : (profile) => handleProfileChange(currentAxis, profile)
            }
          />
        </div>

        <section className="rounded-md bg-muted p-3" aria-label="阶段时间">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-label-caps text-muted-foreground">阶段时间</h3>
            <p className="text-[10px] leading-3 text-muted-foreground">
              拖动控制点或精确输入
            </p>
          </div>
          {kindMeta ? (
            <TrapezoidProfileEditor
              value={displayProfile}
              onChange={(profile) => handleProfileChange(currentAxis, profile)}
              durationMs={axisContext.durationMs}
              disabled={disabled}
              compact
              showKindSelect={false}
              timeUnit="s"
              readOnly={displayProfile.kind === "idle"}
            />
          ) : (
            <p className="text-body-sm text-muted-foreground">未知曲线</p>
          )}
        </section>

        {currentWarnings.length > 0 || currentOverSpeed ? (
          <div className="rounded-md bg-warning-surface px-3 py-2" role="status">
            {currentOverSpeed && currentMaxSpeed !== undefined ? (
              <p className="text-body-sm text-warning">
                峰值速度超过上限 {formatNumber(currentMaxSpeed)} {unit}/s
              </p>
            ) : null}
            {currentWarnings.map((message) => (
              <p key={message} className="text-body-sm text-warning">
                {message}
              </p>
            ))}
          </div>
        ) : null}

        <section className="rounded-md bg-muted p-3" aria-label={`${axisName(currentAxis)} 运动结果`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-label-caps text-muted-foreground">
              {axisName(currentAxis)} 运动结果
            </h3>
            <span className={currentOverSpeed ? "text-body-sm text-warning" : "text-body-sm text-show"}>
              {currentOverSpeed ? "超过限制" : "限制内"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <SegmentMetricTile
              label="峰值速度"
              value={peakVelocityText}
              warning={currentOverSpeed}
            />
            <SegmentMetricTile
              label="速度上限"
              value={maxVelocityText}
            />
            <SegmentMetricTile
              label="加速度"
              value={
                kinematics
                  ? `${formatNumber(kinematics.acceleration)} ${unit}/s²`
                  : "—"
              }
            />
            <SegmentMetricTile
              label="减速度"
              value={
                kinematics
                  ? `${formatNumber(kinematics.deceleration)} ${unit}/s²`
                  : "—"
              }
            />
          </div>
        </section>

        {otherAxes.length > 0 ? (
          <section className="rounded-md bg-muted p-3" aria-label="其他轴">
            <h3 className="mb-2 text-label-caps text-muted-foreground">其他轴</h3>
            <div className="flex flex-col gap-1">
              {otherAxes.map((axis) => {
                const axisUnit = getVirtualAxisCanonicalUnit(
                  axis,
                  axisContext.controlType,
                );
                const axisTravel = axisContext.travel[axis] ?? 0;
                const axisKinematics = tryKinematics(
                  value[axis],
                  Math.abs(axisTravel),
                  axisContext.durationMs,
                );
                const axisMaxSpeed = axisContext.maxSpeedByAxis?.[axis];
                const axisWarning = axisHasWarning(axis, value, axisContext);
                const resultText =
                  axisTravel === 0
                    ? "无位移"
                    : axisKinematics
                      ? axisMaxSpeed === undefined
                        ? `${formatNumber(axisKinematics.peakVelocity)} ${axisUnit}/s`
                        : `${formatNumber(axisKinematics.peakVelocity)} / ${formatNumber(axisMaxSpeed)} ${axisUnit}/s`
                      : "无法计算";

                return (
                  <button
                    key={axis}
                    type="button"
                    aria-label={`切换到 ${axisName(axis)}，${resultText}`}
                    onClick={() => handleAxisClick(axis)}
                    className="grid min-h-9 grid-cols-[32px_minmax(0,1fr)] items-center gap-2 rounded-md bg-input-background px-2 text-left hover:bg-accent"
                  >
                    <span className={cn("font-mono text-mono-sm", axisWarning ? "text-warning" : "text-secondary")}>
                      {axisName(axis)}
                    </span>
                    <span className={cn("truncate text-right font-mono text-[10px] leading-3 tabular-nums", axisWarning ? "text-warning" : "text-muted-foreground")}>
                      {resultText}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ProfileKindSelect
        profile={displayProfile}
        durationMs={axisContext.durationMs}
        minAccelMs={minAccelMs}
        disabled={disabled || displayProfile.kind === "idle"}
        onChange={(profile) => handleProfileChange(currentAxis, profile)}
      />

      <div className="h-44 overflow-visible">
        <VelocityChart
          profile={displayProfile}
          durationMs={axisContext.durationMs}
          velocityUnit={`${unit}/s`}
          limits={limits}
          disabled={disabled || displayProfile.kind === "idle"}
          minAccelMs={minAccelMs}
          onProfileChange={
            displayProfile.kind === "idle"
              ? undefined
              : (profile) => handleProfileChange(currentAxis, profile)
          }
        />
      </div>

      <div className="flex gap-2" role="group" aria-label="虚拟轴">
        {enabledAxes.map((axis) => {
          const pressed = axis === currentAxis;
          return (
            <button
              key={axis}
              type="button"
              aria-label={axisName(axis)}
              aria-pressed={pressed}
              onClick={() => handleAxisClick(axis)}
              className={cn(
                "inline-flex h-9 min-w-10 items-center justify-center rounded-md px-3 text-body-sm font-semibold",
                pressed
                  ? "bg-accent text-primary"
                  : "bg-input-background text-muted-foreground hover:bg-accent",
              )}
            >
              {axisName(axis)}
            </button>
          );
        })}
      </div>

      {kindMeta ? (
        <TrapezoidProfileEditor
          value={displayProfile}
          onChange={(profile) => handleProfileChange(currentAxis, profile)}
          durationMs={axisContext.durationMs}
          disabled={disabled}
          showKindSelect={false}
          timeUnit="s"
          readOnly={displayProfile.kind === "idle"}
        />
      ) : (
        <p className="text-body-sm text-muted-foreground">未知曲线</p>
      )}

      <PhaseFloorWarnings
        profile={displayProfile}
        durationMs={axisContext.durationMs}
        minAccelMs={minAccelMs}
      />

      <AxisMetrics axis={currentAxis} profile={displayProfile} axisContext={axisContext} />

      {otherAxes.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-body-sm text-muted-foreground">
            全部轴
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            {otherAxes.map((axis) => (
              <div key={axis} className="flex flex-col gap-2">
                <p className="text-label-caps text-muted-foreground">{axisName(axis)}</p>
                <AxisMetrics axis={axis} profile={value[axis]} axisContext={axisContext} />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
};
