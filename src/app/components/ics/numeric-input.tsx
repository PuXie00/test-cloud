import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import {
  applyScrubDelta,
  formatNumericDisplay,
  inferPrecision,
  normalizeNumeric,
  parseNumericInput,
} from "./numeric-input-utils";

const DRAG_THRESHOLD_PX = 3;

export type NumericInputJoin = "single" | "first" | "middle" | "last";

export type NumericInputProps = {
  value?: number;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  snapToStep?: boolean;
  sensitivity?: number;
  fineFactor?: number;
  coarseFactor?: number;
  unit?: string;
  prefix?: string;
  /** CSS color value for prefix bar and label. Omit for default label color. */
  prefixColor?: string;
  join?: NumericInputJoin;
  /** 多选共同值不一致时，输入区显示 "--" */
  mixed?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  "aria-label"?: string;
};

export const NumericInput = ({
  value = 0,
  onChange = () => {},
  onCommit,
  step = 1,
  min,
  max,
  precision,
  snapToStep = true,
  sensitivity = 1,
  fineFactor = 0.1,
  coarseFactor = 10,
  unit,
  prefix,
  prefixColor,
  join = "single",
  mixed = false,
  disabled = false,
  readOnly = false,
  className,
  "aria-label": ariaLabel,
}: NumericInputProps) => {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const resolvedPrecision = precision ?? inferPrecision(step);
  const isGrouped = join !== "single";
  const scrubRef = useRef<{
    pointerId: number;
    startX: number;
    startValue: number;
    currentValue: number;
    moved: boolean;
  } | null>(null);

  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [scrubbing, setScrubbing] = useState(false);

  const isInteractive = !disabled && !readOnly;
  const commitValue = useCallback(
    (raw: number, emitCommit = true) => {
      const next = normalizeNumeric(raw, {
        min,
        max,
        step,
        precision: resolvedPrecision,
        snapToStep,
      });
      onChange(next);
      if (emitCommit) {
        onCommit?.(next);
      }
      return next;
    },
    [max, min, onChange, onCommit, resolvedPrecision, snapToStep, step],
  );

  useEffect(() => {
    if (!editing) {
      return;
    }
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  }, [editing]);

  const startEditing = () => {
    if (!isInteractive) {
      return;
    }
    setDraftText(mixed ? "" : formatNumericDisplay(value, resolvedPrecision));
    setEditing(true);
  };

  const finishEditing = (submit: boolean) => {
    if (!editing) {
      return;
    }
    if (submit) {
      const parsed = parseNumericInput(draftText);
      if (parsed != null) {
        commitValue(parsed);
      }
    }
    setEditing(false);
  };

  const handleEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finishEditing(true);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      finishEditing(false);
    }
  };

  const handleInputFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    event.currentTarget.select();
  };

  const handleStep = (direction: -1 | 1, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.preventDefault();
    if (!isInteractive) {
      return;
    }
    const base = mixed ? 0 : value;
    commitValue(base + direction * step);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isInteractive || event.button !== 0) {
      return;
    }
    event.stopPropagation();
    scrubRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: mixed ? 0 : value,
      currentValue: mixed ? 0 : value,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.pointerId !== event.pointerId) {
      return;
    }

    const deltaPx = event.clientX - scrub.startX;
    if (Math.abs(deltaPx) < DRAG_THRESHOLD_PX && !scrub.moved) {
      return;
    }

    scrub.moved = true;
    if (!scrubbing) {
      setScrubbing(true);
    }

    const raw = applyScrubDelta(scrub.startValue, {
      deltaPx,
      step,
      sensitivity,
      fineFactor,
      coarseFactor,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
    });
    scrub.currentValue = commitValue(raw, false);
  };

  const finishScrub = (event: PointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (scrub.moved) {
      onCommit?.(scrub.currentValue);
    } else {
      startEditing();
    }

    scrubRef.current = null;
    setScrubbing(false);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    scrubRef.current = null;
    setScrubbing(false);
  };

  const displayValue = mixed
    ? "--"
    : formatNumericDisplay(
        scrubbing ? (scrubRef.current?.currentValue ?? value) : value,
        resolvedPrecision,
      );
  const stepButtonClass = cn(
    "absolute top-0 z-10 flex h-full w-5 items-center justify-center bg-transparent text-muted-foreground",
    "transition-[opacity,colors] duration-100",
    "opacity-0 group-hover/value:opacity-100 hover:bg-muted/60 hover:text-foreground",
    "disabled:pointer-events-none",
  );

  return (
    <div
      data-history-interaction="numeric"
      data-history-field={ariaLabel ?? inputId}
      className={cn(
        "flex h-8 min-w-0 items-stretch overflow-hidden",
        isGrouped && join !== "last" && "mb-[2px]",
        (disabled || readOnly) && "opacity-50",
        className,
      )}
    >
      {prefix ? (
        <div className="flex w-7 shrink-0 items-stretch">
          <span
            className={cn(
              "flex flex-1 items-center justify-center font-mono text-mono-sm font-semibold tabular-nums",
              !prefixColor && " text-foreground",
            )}
            style={prefixColor ? { color: prefixColor } : undefined}
            aria-hidden
          >
            {prefix}
          </span>
        </div>
      ) : null}
      <div className={cn("group/value relative flex min-w-0 flex-1 items-stretch overflow-hidden", join === "single" && "rounded-md",
        join === "first" && "rounded-t-md",
        join === "last" && "rounded-b-md")}>
        {isInteractive && !editing ? (
          <>
            <button
              type="button"
              className={cn(stepButtonClass, "left-0")}
              aria-label="减少"
              disabled={disabled || readOnly}
              onMouseDown={(event) => handleStep(-1, event)}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <button
              type="button"
              className={cn(stepButtonClass, "right-0")}
              aria-label="增加"
              disabled={disabled || readOnly}
              onMouseDown={(event) => handleStep(1, event)}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </>
        ) : null}

        <div
          className={cn(
            "numeric-input-value relative flex min-w-0 flex-1 items-center justify-center",
            isInteractive && !editing && "cursor-ew-resize select-none",
          )}
          data-scrubbing={scrubbing ? "true" : undefined}
          data-editing={editing ? "true" : undefined}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishScrub}
          onPointerCancel={handlePointerCancel}
        >
          {editing ? (
            <div className="flex items-center justify-center gap-1 px-2">
              <input
                ref={inputRef}
                id={inputId}
                type="text"
                inputMode="decimal"
                disabled={disabled}
                readOnly={readOnly}
                aria-label={ariaLabel}
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
                onFocus={handleInputFocus}
                onBlur={() => finishEditing(true)}
                onKeyDown={handleEditKeyDown}
                onPointerDown={(event) => event.stopPropagation()}
                className="numeric-input-edit w-16 bg-transparent text-center font-mono text-mono-sm tabular-nums text-foreground outline-none"
              />
              {unit ? (
                <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">{unit}</span>
              ) : null}
            </div>
          ) : (
            <span
              className="flex items-center justify-center gap-1 px-2 font-mono text-mono-sm tabular-nums text-foreground"
              aria-label={ariaLabel}
            >
              <span>{displayValue}</span>
              {unit ? <span className="text-muted-foreground">{unit}</span> : null}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
