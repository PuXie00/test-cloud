import { useState } from "react";
import { TabBar } from "@/app/components/ics/tab-bar";
import { cn } from "@/app/components/ui/utils";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import { getDisplayLengthFamilyUnit } from "@/app/project/display-length-units";
import {
  boundaryTrapezoidOf,
  hasMotionBoundary,
  type MotionProfileKinematics,
} from "@/app/project/action-sequence/motion-profile";
import type { AxisMotionProfiles, ModelPose, MotionProfile } from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { VIRTUAL_AXIS_IDS } from "../timeline/timeline-data";
import { getVirtualAxisCanonicalUnit } from "../virtual-axis-display";
import { PROFILE_KIND_OPTIONS, profileKindMeta } from "./profile-kind";
import {
  axisDurationMs,
  maxAccelerationOf,
  minAccelMsOf,
  profileLimitWarnings,
  resolveEnabledAxes,
  tryKinematics,
  type MotionProfileAxisContext,
} from "./motion-profile-status";
import { PHASE_INPUT_MODE_TABS, type PhaseInputMode } from "./phase-rates";
import { formatQuantity, formatQuantityValue } from "./quantity-format";
import { TrapezoidProfileEditor } from "./trapezoid-profile-editor";
import { VelocityChart, type VelocityChartLimits } from "./velocity-chart";

export type { MotionProfileAxisContext };

export type MotionProfileEditorProps = {
  value: AxisMotionProfiles;
  onChange: (profiles: AxisMotionProfiles) => void;
  disabled?: boolean;
  compact?: boolean;
  ownedAxes?: readonly VirtualAxisId[];
  axisContext?: MotionProfileAxisContext;
};

const axisName = (axis: VirtualAxisId): string => axis.toUpperCase();

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

const OverLimitWarning = ({ text }: { text: string }) => (
  <p className="text-body-sm text-warning">超过上限 {text}</p>
);

const LimitWarnings = ({ warnings }: { warnings: string[] }) => {
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
  format,
  max,
  actual,
}: {
  label: string;
  value: number;
  format: (value: number) => string;
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
      {format(value)}
    </p>
    {max !== undefined && actual !== undefined && actual > max ? (
      <OverLimitWarning text={format(max)} />
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
  const display = useSessionDisplayLengthUnit();
  const unit = getVirtualAxisCanonicalUnit(axis, axisContext.controlType);
  const formatSpeed = (speed: number) => formatQuantity(speed, `${unit}/s`, display);
  const formatAccel = (accel: number) => formatQuantity(accel, `${unit}/s²`, display);
  const kinematics = tryKinematics(
    profile,
    Math.abs(axisContext.travel[axis] ?? 0),
    axisDurationMs(axisContext, axis),
  );

  return (
    <div className="flex flex-col gap-2">
      <MetricReadout
        label="峰值速度"
        value={kinematics?.peakVelocity ?? 0}
        format={formatSpeed}
        max={axisContext.maxSpeedByAxis?.[axis]}
        actual={kinematics?.peakVelocity}
      />
      <MetricReadout
        label="加速度"
        value={kinematics?.acceleration ?? 0}
        format={formatAccel}
        actual={kinematics?.acceleration}
      />
      <MetricReadout
        label="减速度"
        value={kinematics?.deceleration ?? 0}
        format={formatAccel}
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

/** 阶段的填法：按时间填加减速时间，按速度填加减速度 */
export const PhaseInputModeTabs = ({
  mode,
  onChange,
}: {
  mode: PhaseInputMode;
  onChange: (mode: PhaseInputMode) => void;
}) => (
  <TabBar
    tabs={PHASE_INPUT_MODE_TABS}
    active={mode}
    onChange={onChange}
    className="h-6 shrink-0 border-b-0 bg-transparent [&>button]:whitespace-nowrap [&>button]:px-2"
  />
);

export const MotionProfileEditor = ({
  value,
  onChange,
  disabled = false,
  compact = false,
  ownedAxes,
  axisContext,
}: MotionProfileEditorProps) => {
  const enabledAxes = (axisContext
    ? resolveEnabledAxes(axisContext.enabledAxes)
    : VIRTUAL_AXIS_IDS
  ).filter((axis) => ownedAxes === undefined || ownedAxes.includes(axis));
  const [selectedAxis, setSelectedAxis] = useState<VirtualAxisId>(() =>
    axisContext ? pickDefaultAxis(enabledAxes, axisContext.travel) : "v1",
  );
  const display = useSessionDisplayLengthUnit();

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
  const currentDurationMs = axisDurationMs(axisContext, currentAxis);
  const otherAxes = enabledAxes.filter((axis) => axis !== currentAxis);
  const unit = getVirtualAxisCanonicalUnit(currentAxis, axisContext.controlType);
  const speedUnit = `${unit}/s`;
  const accelUnit = `${unit}/s²`;
  const speedDisplayUnit = getDisplayLengthFamilyUnit(speedUnit, display);
  const formatSpeedValue = (speed: number) => formatQuantityValue(speed, speedUnit, display);
  const travelDistance = Math.abs(axisContext.travel[currentAxis] ?? 0);
  const displayProfile: MotionProfile =
    travelDistance === 0 || currentProfile.kind === "idle" ? { kind: "idle" } : currentProfile;
  const kindMeta = profileKindMeta(displayProfile.kind);
  const currentBoundary = axisContext.boundaryByAxis?.[currentAxis];
  const withPassSpeeds = hasMotionBoundary(currentBoundary);
  const kinematics = tryKinematics(displayProfile, travelDistance, currentDurationMs, currentBoundary);
  const boundaryShape =
    travelDistance > 0 && currentBoundary && hasMotionBoundary(currentBoundary)
      ? boundaryTrapezoidOf(displayProfile, travelDistance, currentDurationMs, currentBoundary)
      : null;
  const limits =
    travelDistance > 0 && kinematics
      ? toChartLimits(kinematics, currentAxis, axisContext)
      : undefined;
  const minAccelMs = minAccelMsOf(currentAxis, axisContext);
  const currentWarnings = [
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

  return (
    <div className="flex flex-col gap-3">
      <ProfileKindSelect
        profile={displayProfile}
        durationMs={currentDurationMs}
        minAccelMs={minAccelMs}
        disabled={disabled || displayProfile.kind === "idle"}
        onChange={(profile) => handleProfileChange(currentAxis, profile)}
      />

      <div className="h-44 overflow-visible">
        <VelocityChart
          profile={displayProfile}
          durationMs={currentDurationMs}
          velocityUnit={speedDisplayUnit}
          formatVelocity={formatSpeedValue}
          limits={limits}
          disabled={disabled || displayProfile.kind === "idle"}
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
          durationMs={currentDurationMs}
          disabled={disabled}
          showKindSelect={false}
          timeUnit="s"
          readOnly={displayProfile.kind === "idle"}
        />
      ) : (
        <p className="text-body-sm text-muted-foreground">未知曲线</p>
      )}

      <LimitWarnings warnings={currentWarnings} />

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
