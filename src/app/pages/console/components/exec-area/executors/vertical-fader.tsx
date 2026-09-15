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
  disabled?: boolean;
  "aria-label": string;
  className?: string;
};

export const VerticalFader = ({
  value,
  onChange,
  disabled = false,
  "aria-label": ariaLabel,
  className,
}: VerticalFaderProps) => {
  const fillPercent = `${(value / FADER_MAX) * 100}%`;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onChange(faderValueFromClientY(event.clientY, event.currentTarget.getBoundingClientRect()));
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onChange(faderValueFromClientY(event.clientY, event.currentTarget.getBoundingClientRect()));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = stepFaderValue(value, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    onChange(next);
  };

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={FADER_MIN}
      aria-valuemax={FADER_MAX}
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
      <div
        className="absolute left-1/2 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-sm border border-border bg-card"
        style={{ bottom: fillPercent }}
      />
    </div>
  );
};
