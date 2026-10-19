import { toast } from "sonner";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { cn } from "@/app/components/ui/utils";
import {
  cruiseMsOf,
  withTrapezoidAccelMs,
  withTrapezoidDecelMs,
  type MotionBoundary,
} from "@/app/project/action-sequence/motion-profile";
import type { MotionProfile } from "@/app/project/action-sequence/types";
import { formatTime, secondsToMs, snapTimeMs } from "../timeline/timeline-data";
import {
  RATES_DO_NOT_FIT_MESSAGE,
  profileFromRates,
  trapezoidRatesOf,
  type PhaseInputMode,
} from "./phase-rates";

export type TrapezoidProfileEditorProps = {
  value: MotionProfile;
  onChange: (profile: MotionProfile) => void;
  durationMs: number;
  disabled?: boolean;
  compact?: boolean;
  showKindSelect?: boolean;
  timeUnit?: "ms" | "s";
  readOnly?: boolean;
  /** 两端带经过速度：首尾两段是从经过速度变到匀速，不一定从 0 起、到 0 止 */
  withPassSpeeds?: boolean;
  /** 按速度：填加减速度，区间时长不变，匀速速度和阶段时间跟着算 */
  inputMode?: PhaseInputMode;
  /** 按速度时用：这段的行程（绝对值）、进出速度和轴的长度单位（mm 或 °） */
  rateContext?: { distance: number; boundary?: MotionBoundary; unit: string };
};

const formatPhaseValue = (valueMs: number, timeUnit: "ms" | "s"): string => {
  if (timeUnit === "s") return formatTime(valueMs);
  return Number.isInteger(valueMs) ? String(valueMs) : String(Math.round(valueMs));
};

const commitPhaseMs = (parsed: number, timeUnit: "ms" | "s"): number =>
  timeUnit === "s" ? secondsToMs(parsed) : snapTimeMs(parsed);

type PhaseFieldProps = {
  label: string;
  value: number;
  /** 多选时各段不一样：显示 -- */
  mixed?: boolean;
  disabled?: boolean;
  compact?: boolean;
  readOnly?: boolean;
  timeUnit?: "ms" | "s";
  onValueCommit?: (nextMs: number) => void;
};

export const PhaseField = ({
  label,
  value,
  mixed = false,
  disabled = false,
  compact = false,
  readOnly = false,
  timeUnit = "ms",
  onValueCommit,
}: PhaseFieldProps) => {
  const handleCommit = (rawValue: string) => {
    if (readOnly || !onValueCommit) return;
    const parsed = Number.parseFloat(rawValue);
    if (!Number.isFinite(parsed)) return;
    onValueCommit(commitPhaseMs(parsed, timeUnit));
  };

  return (
    <label
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1",
        compact ? "gap-0.5" : "gap-1",
      )}
    >
      <span className={cn("text-muted-foreground", compact ? "text-body-sm" : "text-body-sm")}>
        {label}
      </span>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={timeUnit === "s" ? 0.1 : 1}
          defaultValue={mixed ? "" : formatPhaseValue(value, timeUnit)}
          placeholder={mixed ? "--" : undefined}
          key={`${label}-${mixed ? "mixed" : formatPhaseValue(value, timeUnit)}-${timeUnit}`}
          disabled={disabled}
          readOnly={readOnly}
          aria-label={label}
          aria-readonly={readOnly ? "true" : undefined}
          onBlur={(event) => handleCommit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (readOnly) return;
            if (event.key !== "Enter") return;
            handleCommit(event.currentTarget.value);
          }}
          className={cn(
            "w-full rounded-md border border-border/60 bg-input-background pr-9 text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-ring",
            compact ? "h-8 px-2 text-body-sm" : "h-9 px-3 text-body-md",
            readOnly && "cursor-default opacity-80",
          )}
        />
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 right-2 flex items-center text-muted-foreground",
            compact ? "text-body-sm" : "text-body-md",
          )}
        >
          {timeUnit}
        </span>
      </div>
    </label>
  );
};

type RateFieldProps = {
  label: string;
  value: number | undefined;
  /** 长度单位的速度或加速度，如 mm/s²；长度类按显示单位换算 */
  unit?: string;
  mixed?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  onValueCommit?: (next: number) => void;
};

/** 按速度时的一格：加速度、匀速速度或减速度 */
export const RateField = ({
  label,
  value,
  unit,
  mixed = false,
  disabled = false,
  readOnly = false,
  onValueCommit,
}: RateFieldProps) => (
  <div className="flex items-center gap-2">
    <span className="w-20 shrink-0 text-body-sm text-muted-foreground">{label}</span>
    <UnitAwareNumericInput
      aria-label={label}
      value={value ?? 0}
      mixed={mixed || value === undefined}
      unit={unit}
      min={0}
      step={1}
      precision={1}
      snapToStep={false}
      disabled={disabled}
      readOnly={readOnly || !onValueCommit}
      onCommit={
        onValueCommit
          ? (next) => {
              if (next > 0) onValueCommit(next);
            }
          : undefined
      }
      className="min-w-0 flex-1 rounded-md border border-border/60 bg-input-background"
    />
  </div>
);

/** 两端带经过速度时首尾两段不一定从 0 加速、减到 0，标签跟着换 */
export const phaseFieldLabels = (
  inputMode: PhaseInputMode,
  withPassSpeeds: boolean,
): { first: string; middle: string; last: string } =>
  inputMode === "speed"
    ? {
        first: withPassSpeeds ? "段首加速度" : "加速度",
        middle: "匀速速度",
        last: withPassSpeeds ? "段尾减速度" : "减速度",
      }
    : {
        first: withPassSpeeds ? "段首变速" : "加速时间",
        middle: "匀速时间",
        last: withPassSpeeds ? "段尾变速" : "减速时间",
      };

export const TrapezoidProfileEditor = ({
  value,
  onChange,
  durationMs,
  disabled = false,
  compact = false,
  showKindSelect = true,
  timeUnit = "ms",
  readOnly = false,
  withPassSpeeds = false,
  inputMode = "time",
  rateContext,
}: TrapezoidProfileEditorProps) => {
  const labels = phaseFieldLabels(inputMode, withPassSpeeds);
  const cruiseMs = cruiseMsOf(value, durationMs);
  const accelMs = value.kind === "trapezoid" ? value.params.accelMs : 0;
  const decelMs = value.kind === "trapezoid" ? value.params.decelMs : 0;

  const handleAccelerationChange = (nextMs: number) => {
    const nextProfile = withTrapezoidAccelMs(value, nextMs);
    if (nextProfile) onChange(nextProfile);
  };

  const handleDecelerationChange = (nextMs: number) => {
    const nextProfile = withTrapezoidDecelMs(value, nextMs);
    if (nextProfile) onChange(nextProfile);
  };

  return (
    <div className={cn("flex flex-col", compact ? "gap-2" : "gap-3")}>
      {showKindSelect ? (
        <label className={cn("flex flex-col", compact ? "gap-0.5" : "gap-1")}>
          <span className="text-body-sm text-muted-foreground">曲线类型</span>
          <select
            aria-label="曲线类型"
            value="trapezoid"
            disabled={disabled}
            className={cn(
              "rounded-md border border-border/60 bg-input-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring",
              compact ? "h-8 px-2 text-body-sm" : "h-9 px-3 text-body-md",
            )}
          >
            <option value="trapezoid">梯形</option>
          </select>
        </label>
      ) : null}

      {inputMode === "speed" && rateContext ? (
        <RateFields
          value={value}
          durationMs={durationMs}
          rateContext={rateContext}
          labels={labels}
          disabled={disabled}
          readOnly={readOnly}
          onChange={onChange}
        />
      ) : (
        <div className={cn("grid grid-cols-3", compact ? "gap-2" : "gap-3")}>
          <PhaseField
            label={labels.first}
            value={accelMs}
            disabled={disabled}
            compact={compact}
            readOnly={readOnly}
            timeUnit={timeUnit}
            onValueCommit={readOnly ? undefined : handleAccelerationChange}
          />
          <PhaseField
            label={labels.middle}
            value={cruiseMs}
            disabled={disabled}
            compact={compact}
            readOnly
            timeUnit={timeUnit}
          />
          <PhaseField
            label={labels.last}
            value={decelMs}
            disabled={disabled}
            compact={compact}
            readOnly={readOnly}
            timeUnit={timeUnit}
            onValueCommit={readOnly ? undefined : handleDecelerationChange}
          />
        </div>
      )}
    </div>
  );
};

/** 按速度：改加速度时保持减速度，改减速度时保持加速度，算出新的阶段时间 */
const RateFields = ({
  value,
  durationMs,
  rateContext,
  labels,
  disabled,
  readOnly,
  onChange,
}: {
  value: MotionProfile;
  durationMs: number;
  rateContext: NonNullable<TrapezoidProfileEditorProps["rateContext"]>;
  labels: { first: string; middle: string; last: string };
  disabled: boolean;
  readOnly: boolean;
  onChange: (profile: MotionProfile) => void;
}) => {
  const { distance, boundary, unit } = rateContext;
  const rates = trapezoidRatesOf(value, distance, durationMs, boundary);
  const editable = !readOnly && value.kind === "trapezoid" && distance > 0;
  const commit = (acceleration: number, deceleration: number) => {
    const next = profileFromRates({ distance, durationMs, boundary, acceleration, deceleration });
    if (!next) {
      toast.warning(RATES_DO_NOT_FIT_MESSAGE);
      return;
    }
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <RateField
        label={labels.first}
        value={rates?.acceleration}
        unit={`${unit}/s²`}
        disabled={disabled}
        readOnly={!editable}
        onValueCommit={
          editable ? (next) => commit(next, rates?.deceleration ?? next) : undefined
        }
      />
      <RateField
        label={labels.middle}
        value={rates?.cruiseSpeed}
        unit={`${unit}/s`}
        disabled={disabled}
        readOnly
      />
      <RateField
        label={labels.last}
        value={rates?.deceleration}
        unit={`${unit}/s²`}
        disabled={disabled}
        readOnly={!editable}
        onValueCommit={
          editable ? (next) => commit(rates?.acceleration ?? next, next) : undefined
        }
      />
    </div>
  );
};
