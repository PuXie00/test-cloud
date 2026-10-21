import { cn } from "@/app/components/ui/utils";
import {
  FADER_MAX,
  FADER_MIN,
  faderValueFromClientY,
  stepFaderValue,
} from "./vertical-fader-math";

export type VerticalFaderProps = {
  value: number;
  onChange: (value: number) => void;
  /** 调速范围给出的上限；推不过它，轨道上画一道刻线。null / 缺省为不限 */
  limit?: number | null;
  disabled?: boolean;
  "aria-label": string;
  className?: string;
};

export const VerticalFader = ({
  value,
  onChange,
  limit = null,
  disabled = false,
  "aria-label": ariaLabel,
  className,
}: VerticalFaderProps) => {
  const fillPercent = `${(value / FADER_MAX) * 100}%`;
  const capped = limit !== null && limit < FADER_MAX;
  const maxValue = capped ? Math.max(FADER_MIN, limit) : FADER_MAX;
  const emit = (next: number) => onChange(Math.min(next, maxValue));

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    emit(faderValueFromClientY(event.clientY, event.currentTarget.getBoundingClientRect()));
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    emit(faderValueFromClientY(event.clientY, event.currentTarget.getBoundingClientRect()));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = stepFaderValue(value, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    emit(next);
  };

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={FADER_MIN}
      aria-valuemax={maxValue}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative min-h-0 w-full flex-1 touch-none outline-none focus-visible:ring-1 focus-visible:ring-primary",
        disabled && "pointer-events-none opacity-30",
        className,
      )}
    >
      <div className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-muted" />
      <div
        className="absolute bottom-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-primary"
        style={{ height: fillPercent }}
      />
      {capped ? (
        <div
          data-testid="fader-limit"
          className="absolute left-1/2 h-0.5 w-4 -translate-x-1/2 translate-y-1/2 rounded-full bg-warning"
          style={{ bottom: `${(maxValue / FADER_MAX) * 100}%` }}
        />
      ) : null}
      <div
        className="absolute left-1/2 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-sm border border-border bg-card"
        style={{ bottom: fillPercent }}
      />
    </div>
  );
};
