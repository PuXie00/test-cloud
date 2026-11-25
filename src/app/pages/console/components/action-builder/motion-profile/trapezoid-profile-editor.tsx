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
import { TIME_STEP_MS, formatTime, secondsToMs, snapTimeMs } from "../timeline/timeline-data";
import {
  SPEED_UNREACHABLE_MESSAGE,
  retimeFromRates,
  stepPhaseTime,
  stepRetimedRate,
  stepRetimedSpeed,
  trapezoidRatesOf,
  type RatePhase,
  type PhaseInputMode,
  type RetimedProfile,
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
  /** 按速度：填加速度、匀速速度、减速度，时长和阶段时间跟着算（要给 onRetime） */
  inputMode?: PhaseInputMode;
  /** 按速度时用：这段的行程（绝对值）、进出速度和轴的长度单位（mm 或 °） */
  rateContext?: { distance: number; boundary?: MotionBoundary; unit: string };
  /** 按速度改出来的曲线和这段的新时长 */
  onRetime?: (profile: MotionProfile, durationMs: number) => void;
  /** 段首 / 段尾不变速：起点经过速度跟后段 / 终点经过速度跟前段（等于这段的匀速） */
  flatEnds?: { start: boolean; end: boolean };
  /**
   * 段首 / 段尾变速填 0（或在 0.1 s 再点 −）时切成不变速，flat 为 false 时改回；
   * nextProfile 是同一步要换的曲线（不变速时填了一个时长）。不传时变速时间最少 0.1 s
   */
  onFlatEndChange?: (end: FlatEnd, flat: boolean, nextProfile?: MotionProfile) => void;
};

export type FlatEnd = "start" | "end";

/** 变化率小于这个当作不变速（进出速度就是匀速） */
const FLAT_RATE_EPS = 1e-6;

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
  /** 能填 0（段首、段尾不变速） */
  allowZero?: boolean;
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
  allowZero = false,
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
              if (next > 0 || (allowZero && next === 0)) onValueCommit(next);
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
  onRetime,
  flatEnds,
  onFlatEndChange,
}: TrapezoidProfileEditorProps) => {
  const labels = phaseFieldLabels(inputMode, withPassSpeeds);
  const cruiseMs = cruiseMsOf(value, durationMs);
  const accelMs = value.kind === "trapezoid" ? value.params.accelMs : 0;
  const decelMs = value.kind === "trapezoid" ? value.params.decelMs : 0;
  const flat = (end: FlatEnd) => (end === "start" ? flatEnds?.start : flatEnds?.end) === true;

  /** 填一个变速时间：0 是不变速；不变速时填了时长就改回来，同一步换曲线 */
  const commitPhaseTime = (end: FlatEnd, nextMs: number) => {
    if (nextMs <= 0) {
      if (!flat(end)) onFlatEndChange?.(end, true);
      return;
    }
    const nextProfile =
      end === "start" ? withTrapezoidAccelMs(value, nextMs) : withTrapezoidDecelMs(value, nextMs);
    if (!nextProfile) return;
    if (flat(end) && onFlatEndChange) {
      onFlatEndChange(end, false, nextProfile);
      return;
    }
    onChange(nextProfile);
  };

  // 连点 − + 时还没重新渲染就来了下一下，从刚写的那一档接着走
  const latestRef = useRef(value);
  latestRef.current = value;
  const stepTime = (phase: RatePhase) => (delta: number) => {
    const end: FlatEnd = phase === "accel" ? "start" : "end";
    // 不变速时显示 0：点 + 改回原来的变速时间
    if (flat(end)) {
      if (delta > 0) onFlatEndChange?.(end, false);
      return;
    }
    const next = stepPhaseTime(latestRef.current, durationMs, phase, delta);
    if (!next) {
      const ownMs = phase === "accel" ? accelMs : decelMs;
      if (delta < 0 && ownMs <= TIME_STEP_MS) onFlatEndChange?.(end, true);
      return;
    }
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

      {inputMode === "speed" && rateContext && onRetime ? (
        <RateFields
          value={value}
          durationMs={durationMs}
          rateContext={rateContext}
          labels={labels}
          disabled={disabled}
          readOnly={readOnly}
          onRetime={onRetime}
          flatEnds={flatEnds}
          onFlatEndChange={onFlatEndChange}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          <TimeRow
            label={labels.first}
            valueMs={flat("start") ? 0 : accelMs}
            disabled={disabled}
            readOnly={readOnly}
            timeUnit={timeUnit}
            onValueCommit={readOnly ? undefined : (nextMs) => commitPhaseTime("start", nextMs)}
            onStep={stepTime("accel")}
          />
          <TimeRow label={labels.middle} valueMs={cruiseMs} disabled={disabled} readOnly timeUnit={timeUnit} />
          <TimeRow
            label={labels.last}
            valueMs={flat("end") ? 0 : decelMs}
            disabled={disabled}
            readOnly={readOnly}
            timeUnit={timeUnit}
            onValueCommit={readOnly ? undefined : (nextMs) => commitPhaseTime("end", nextMs)}
            onStep={stepTime("decel")}
          />
        </div>
      )}
      <FlatEndNotes flatEnds={flatEnds} />
    </div>
  );
};

/** 不变速的一头写明是怎么来的：经过速度跟着这段的匀速 */
const FlatEndNotes = ({ flatEnds }: { flatEnds?: { start: boolean; end: boolean } }) =>
  flatEnds?.start || flatEnds?.end ? (
    <div className="flex flex-col gap-0.5 text-body-sm text-muted-foreground">
      {flatEnds.start ? <p>段首不变速：起点经过速度跟后段（这段的匀速）</p> : null}
      {flatEnds.end ? <p>段尾不变速：终点经过速度跟前段（这段的匀速）</p> : null}
    </div>
  ) : null;

/**
 * 按速度：三个值都能改，改哪个就保持另外两个，时长跟着算。
 * 点 − +：加减速度一档是这段变速时间差 0.1 s，匀速速度一档是时长差 0.1 s。
 */
const RateFields = ({
  value,
  durationMs,
  rateContext,
  labels,
  disabled,
  readOnly,
  onRetime,
  flatEnds,
  onFlatEndChange,
}: {
  value: MotionProfile;
  durationMs: number;
  rateContext: NonNullable<TrapezoidProfileEditorProps["rateContext"]>;
  labels: { first: string; middle: string; last: string };
  disabled: boolean;
  readOnly: boolean;
  onRetime: (profile: MotionProfile, durationMs: number) => void;
  flatEnds?: { start: boolean; end: boolean };
  onFlatEndChange?: (end: FlatEnd, flat: boolean, nextProfile?: MotionProfile) => void;
}) => {
  const { distance, boundary, unit } = rateContext;
  const rates = trapezoidRatesOf(value, distance, durationMs, boundary);
  const editable = !readOnly && value.kind === "trapezoid" && distance > 0 && rates !== null;
  // 连点 − + 时还没重新渲染就来了下一下，从刚写的那一档接着走
  const latestRef = useRef<RetimedProfile>({ profile: value, durationMs });
  latestRef.current = { profile: value, durationMs };
  const write = (next: RetimedProfile) => {
    latestRef.current = next;
    onRetime(next.profile, next.durationMs);
  };
  const commit = (patch: Partial<{ acceleration: number; cruiseSpeed: number; deceleration: number }>) => {
    if (!rates || value.kind !== "trapezoid") return;
    const merged = { ...rates, ...patch };
    // 一头不变速（变化率是 0）时改匀速：这一头按原来的变速时间变到新匀速（加加速、减减速）
    if (patch.cruiseSpeed !== undefined) {
      const vs = boundary?.startSpeed ?? 0;
      const ve = boundary?.endSpeed ?? 0;
      if (!(merged.acceleration > FLAT_RATE_EPS)) {
        merged.acceleration = Math.abs(patch.cruiseSpeed - vs) / (value.params.accelMs / 1000) || 1;
      }
      if (!(merged.deceleration > FLAT_RATE_EPS)) {
        merged.deceleration = Math.abs(patch.cruiseSpeed - ve) / (value.params.decelMs / 1000) || 1;
      }
    }
    const next = retimeFromRates({ distance, boundary, ...merged });
    if (!next) {
      toast.warning(SPEED_UNREACHABLE_MESSAGE);
      return;
    }
    write(next);
  };

  /** 段首加速度 / 段尾减速度填 0 是不变速；不变速时填了数值先改回自动经过速度 */
  const commitRate = (end: FlatEnd, next: number) => {
    const isFlat = (end === "start" ? flatEnds?.start : flatEnds?.end) === true;
    if (next === 0) {
      if (!isFlat) onFlatEndChange?.(end, true);
      return;
    }
    if (isFlat && onFlatEndChange) {
      onFlatEndChange(end, false);
      toast.info(`${end === "start" ? "起点" : "终点"}经过速度改回自动，需要的话再填一次${end === "start" ? "加速度" : "减速度"}`);
      return;
    }
    commit(end === "start" ? { acceleration: next } : { deceleration: next });
  };
  const stepRate = (phase: RatePhase) => (delta: number) => {
    const next = stepRetimedRate({ ...latestRef.current, distance, boundary, phase, steps: delta });
    if (next) write(next);
  };
  const stepSpeed = (delta: number) => {
    const next = stepRetimedSpeed({ ...latestRef.current, distance, boundary, steps: delta });
    if (next) write(next);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <RateRow
        label={labels.first}
        value={rates?.acceleration}
        unit={`${unit}/s²`}
        disabled={disabled}
        readOnly={!editable}
        allowZero={onFlatEndChange !== undefined}
        onValueCommit={editable ? (next) => commitRate("start", next) : undefined}
        onStep={editable ? stepRate("accel") : undefined}
      />
      <RateRow
        label={labels.middle}
        value={rates?.cruiseSpeed}
        unit={`${unit}/s`}
        disabled={disabled}
        readOnly={!editable}
        onValueCommit={editable ? (next) => commit({ cruiseSpeed: next }) : undefined}
        onStep={editable ? stepSpeed : undefined}
      />
      <RateRow
        label={labels.last}
        value={rates?.deceleration}
        unit={`${unit}/s²`}
        disabled={disabled}
        readOnly={!editable}
        allowZero={onFlatEndChange !== undefined}
        onValueCommit={editable ? (next) => commitRate("end", next) : undefined}
        onStep={editable ? stepRate("decel") : undefined}
      />
    </div>
  );
};
