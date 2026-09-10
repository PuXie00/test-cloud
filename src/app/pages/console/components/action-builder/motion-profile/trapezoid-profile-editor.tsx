import { cn } from "@/app/components/ui/utils";
import {
  cruiseMsOf,
  withTrapezoidAccelMs,
  withTrapezoidDecelMs,
} from "@/app/project/action-sequence/motion-profile";
import type { MotionProfile } from "@/app/project/action-sequence/types";

export type TrapezoidProfileEditorProps = {
  value: MotionProfile;
  onChange: (profile: MotionProfile) => void;
  durationMs: number;
  disabled?: boolean;
  compact?: boolean;
  showKindSelect?: boolean;
  timeUnit?: "ms" | "s";
};

const formatTime = (valueMs: number, timeUnit: "ms" | "s"): string => {
  if (timeUnit === "s") return (valueMs / 1000).toFixed(2);
  return Number.isInteger(valueMs) ? String(valueMs) : String(Math.round(valueMs));
};

type PhaseFieldProps = {
  label: string;
  value: number;
  disabled?: boolean;
  compact?: boolean;
  readOnly?: boolean;
  timeUnit?: "ms" | "s";
  onValueCommit?: (nextMs: number) => void;
};

const PhaseField = ({
  label,
  value,
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
    onValueCommit(timeUnit === "s" ? parsed * 1000 : parsed);
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
          step={timeUnit === "s" ? 0.01 : 1}
          defaultValue={formatTime(value, timeUnit)}
          key={`${label}-${formatTime(value, timeUnit)}-${timeUnit}`}
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

export const TrapezoidProfileEditor = ({
  value,
  onChange,
  durationMs,
  disabled = false,
  compact = false,
  showKindSelect = true,
  timeUnit = "ms",
}: TrapezoidProfileEditorProps) => {
  const cruiseMs = cruiseMsOf(value, durationMs);

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
            readOnly
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

      <div className={cn("grid grid-cols-3", compact ? "gap-2" : "gap-3")}>
        <PhaseField
          label="加速时间"
          value={value.params.accelMs}
          disabled={disabled}
          compact={compact}
          timeUnit={timeUnit}
          onValueCommit={handleAccelerationChange}
        />
        <PhaseField
          label="匀速时间"
          value={cruiseMs}
          disabled={disabled}
          compact={compact}
          readOnly
          timeUnit={timeUnit}
        />
        <PhaseField
          label="减速时间"
          value={value.params.decelMs}
          disabled={disabled}
          compact={compact}
          timeUnit={timeUnit}
          onValueCommit={handleDecelerationChange}
        />
      </div>
    </div>
  );
};
