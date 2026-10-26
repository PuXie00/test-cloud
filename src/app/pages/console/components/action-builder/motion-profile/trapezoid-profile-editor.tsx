import { useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/components/ui/utils";
import {
  cruiseMsOf,
  withTrapezoidAccelMs,
  withTrapezoidDecelMs,
  type MotionBoundary,
} from "@/app/project/action-sequence/motion-profile";
import type { MotionProfile } from "@/app/project/action-sequence/types";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import {
  getDisplayLengthFamilyUnit,
  isLengthFamilyUnit,
  resolveDisplayPrecision,
  toCanonicalLengthValue,
  toDisplayLengthValue,
} from "@/app/project/display-length-units";
import { formatTime, secondsToMs, snapTimeMs } from "../timeline/timeline-data";
import {
  RATES_DO_NOT_FIT_MESSAGE,
  profileFromRates,
  stepPhaseRate,
  stepPhaseTime,
  trapezoidRatesOf,
  type RatePhase,
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

type PhaseRowProps = {
  label: string;
  /** 不在键入时显示的文字 */
  text: string;
  unit?: string;
  precision: number;
  /** 多选时各段不一样：显示 -- */
  mixed?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** 键入后回车或离开输入框时提交 */
  onTextCommit?: (text: string) => void;
  /** − + 一次一档（阶段时间差 0.1 s），由父组件写入 */
  onStep?: (delta: number) => void;
};

/** 阶段的一行：左边名称，右边带 − + 的数字框；按时间、按速度共用 */
const PhaseRow = ({
  label,
  text,
  unit,
  precision,
  mixed = false,
  disabled = false,
  readOnly = false,
  onTextCommit,
  onStep,
}: PhaseRowProps) => {
  const [draft, setDraft] = useState<string | null>(null);
  const editable = !readOnly && onTextCommit !== undefined;
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft.trim() !== "") onTextCommit?.(draft);
  };
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-body-sm text-muted-foreground">{label}</span>
      <Input
        type="number"
        showStepper
        aria-label={label}
        value={draft ?? (mixed ? "" : text)}
        placeholder={mixed ? "--" : undefined}
        unit={unit}
        precision={precision}
        step={10 ** -precision}
        min={0}
        disabled={disabled}
        readOnly={!editable}
        aria-readonly={editable ? undefined : "true"}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") setDraft(null);
        }}
        onStep={editable ? onStep : undefined}
        className="text-body-sm tabular-nums"
      />
    </div>
  );
};

type TimeRowProps = {
  label: string;
  valueMs: number;
  mixed?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  timeUnit?: "ms" | "s";
  onValueCommit?: (nextMs: number) => void;
  onStep?: (delta: number) => void;
};

/** 按时间的一行：加速时间、匀速时间或减速时间 */
export const TimeRow = ({
  label,
  valueMs,
  mixed,
  disabled,
  readOnly,
  timeUnit = "s",
  onValueCommit,
  onStep,
}: TimeRowProps) => (
  <PhaseRow
    label={label}
    text={formatPhaseValue(valueMs, timeUnit)}
    unit={timeUnit}
    precision={timeUnit === "s" ? 1 : 0}
    mixed={mixed}
    disabled={disabled}
    readOnly={readOnly}
    onTextCommit={
      onValueCommit
        ? (text) => {
            const parsed = Number.parseFloat(text);
            if (Number.isFinite(parsed)) onValueCommit(commitPhaseMs(parsed, timeUnit));
          }
        : undefined
    }
    onStep={onStep}
  />
);

type RateRowProps = {
  label: string;
  value: number | undefined;
  /** 速度或加速度单位，如 mm/s²；长度类按显示单位换算 */
  unit?: string;
  mixed?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  onValueCommit?: (next: number) => void;
  onStep?: (delta: number) => void;
};

/** 按速度的一行：加速度、匀速速度或减速度 */
export const RateRow = ({
  label,
  value,
  unit,
  mixed = false,
  disabled,
  readOnly,
  onValueCommit,
  onStep,
}: RateRowProps) => {
  const display = useSessionDisplayLengthUnit();
  const lengthy = isLengthFamilyUnit(unit);
  const precision = lengthy ? resolveDisplayPrecision(1, display) : 1;
  const shown = value === undefined ? 0 : lengthy ? toDisplayLengthValue(value, display) : value;
  return (
    <PhaseRow
      label={label}
      text={shown.toFixed(precision)}
      unit={unit && lengthy ? getDisplayLengthFamilyUnit(unit, display) : unit}
      precision={precision}
      mixed={mixed || value === undefined}
      disabled={disabled}
      readOnly={readOnly}
      onTextCommit={
        onValueCommit
          ? (text) => {
              const parsed = Number.parseFloat(text);
              if (!Number.isFinite(parsed)) return;
              const next = lengthy ? toCanonicalLengthValue(parsed, display) : parsed;
              if (next > 0) onValueCommit(next);
            }
          : undefined
      }
      onStep={onStep}
    />
  );
};

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

  // 连点 − + 时还没重新渲染就来了下一下，从刚写的那一档接着走
  const latestRef = useRef(value);
  latestRef.current = value;
  const stepTime = (phase: RatePhase) => (delta: number) => {
    const next = stepPhaseTime(latestRef.current, durationMs, phase, delta);
    if (!next) return;
    latestRef.current = next;
    onChange(next);
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
        <div className="flex flex-col gap-1.5">
          <TimeRow
            label={labels.first}
            valueMs={accelMs}
            disabled={disabled}
            readOnly={readOnly}
            timeUnit={timeUnit}
            onValueCommit={readOnly ? undefined : handleAccelerationChange}
            onStep={stepTime("accel")}
          />
          <TimeRow label={labels.middle} valueMs={cruiseMs} disabled={disabled} readOnly timeUnit={timeUnit} />
          <TimeRow
            label={labels.last}
            valueMs={decelMs}
            disabled={disabled}
            readOnly={readOnly}
            timeUnit={timeUnit}
            onValueCommit={readOnly ? undefined : handleDecelerationChange}
            onStep={stepTime("decel")}
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
  // 连点 − + 时还没重新渲染就来了下一下，从刚写的那一档接着走
  const latestRef = useRef(value);
  latestRef.current = value;
  const commit = (acceleration: number, deceleration: number) => {
    const next = profileFromRates({ distance, durationMs, boundary, acceleration, deceleration });
    if (!next) {
      toast.warning(RATES_DO_NOT_FIT_MESSAGE);
      return;
    }
    onChange(next);
  };
  const step = (phase: RatePhase) => (delta: number) => {
    const next = stepPhaseRate({ profile: latestRef.current, distance, durationMs, boundary, phase, steps: delta });
    if (!next) return;
    latestRef.current = next;
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <RateRow
        label={labels.first}
        value={rates?.acceleration}
        unit={`${unit}/s²`}
        disabled={disabled}
        readOnly={!editable}
        onValueCommit={
          editable ? (next) => commit(next, rates?.deceleration ?? next) : undefined
        }
        onStep={editable ? step("accel") : undefined}
      />
      <RateRow
        label={labels.middle}
        value={rates?.cruiseSpeed}
        unit={`${unit}/s`}
        disabled={disabled}
        readOnly
      />
      <RateRow
        label={labels.last}
        value={rates?.deceleration}
        unit={`${unit}/s²`}
        disabled={disabled}
        readOnly={!editable}
        onValueCommit={
          editable ? (next) => commit(rates?.acceleration ?? next, next) : undefined
        }
        onStep={editable ? step("decel") : undefined}
      />
    </div>
  );
};
