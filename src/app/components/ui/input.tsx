import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "./utils";
import { controlClass } from "@/app/components/ui/forms/form-tokens";
import {
  resolveInputPrecision,
  roundToInputPrecision,
  sanitizeNumericDraft,
} from "./input-numeric";

export type InputProps = Omit<React.ComponentProps<"input">, "readOnly"> & {
  showStepper?: boolean;
  readOnly?: boolean;
  /** 内嵌在输入框右侧的单位后缀（仅 showStepper 数字输入生效） */
  unit?: string;
  /** 获得焦点时全选当前值 */
  selectOnFocus?: boolean;
  /**
   * 数字输入允许的小数位数。`0` 为整数。
   * 未传时：`type="number"` 默认整数；若 `step` 带小数则按 step 推断。
   */
  precision?: number;
};

const stepButtonClassName =
  "flex w-6 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      showStepper,
      readOnly,
      value,
      onChange,
      min,
      max,
      step,
      disabled,
      unit,
      selectOnFocus,
      onFocus,
      precision,
      ...props
    },
    ref,
  ) => {
    const isStepper = type === "number" && showStepper;
    const isNumeric = type === "number";
    const resolvedPrecision = resolveInputPrecision(precision, step);

    const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
      if (selectOnFocus) {
        event.currentTarget.select();
      }
      onFocus?.(event);
    };

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!isNumeric) {
        onChange?.(event);
        return;
      }
      const sanitized = sanitizeNumericDraft(event.target.value, resolvedPrecision);
      if (sanitized == null) {
        event.target.value = value == null ? "" : String(value);
        return;
      }
      if (event.target.value !== sanitized) {
        event.target.value = sanitized;
      }
      onChange?.(event);
    };

    const handleStep = (delta: number) => {
      if (disabled || readOnly || !onChange) return;
      const current = Number(value ?? 0);
      const stepVal = Number(step ?? 1);
      const next = roundToInputPrecision(
        (Number.isFinite(current) ? current : 0) + delta * stepVal,
        resolvedPrecision,
      );
      const clampedMin = min != null ? Math.max(next, Number(min)) : next;
      const clamped = max != null ? Math.min(clampedMin, Number(max)) : clampedMin;
      const synthetic = {
        target: { value: String(clamped) },
      } as React.ChangeEvent<HTMLInputElement>;
      onChange(synthetic);
    };

    const unitSuffix = unit ? (
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-mono-sm tabular-nums text-muted-foreground">
        {unit}
      </span>
    ) : null;

    const inputEl = (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        readOnly={readOnly}
        value={value}
        onChange={handleChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onFocus={handleFocus}
        className={cn(
          "flex w-full min-w-0 bg-input-background px-3 py-1 text-body-md text-foreground transition-colors outline-none",
          !isStepper &&
            cn(
              "rounded-sm border border-border",
              controlClass,
              "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
            ),
          isStepper && "h-full min-h-0 rounded-none border-x border-border",
          unit && "pr-8",
          "placeholder:text-muted-foreground",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          readOnly && "cursor-default bg-input-background/60 text-muted-foreground",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
          type === "number" &&
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          className,
        )}
        {...props}
      />
    );

    if (!isStepper) {
      return unit ? (
        <div className="relative flex w-full min-w-0 items-center">
          {inputEl}
          {unitSuffix}
        </div>
      ) : (
        inputEl
      );
    }

    return (
      <div
        className={cn(
          "flex min-w-0 w-full items-stretch overflow-hidden rounded-sm border border-border bg-input-background",
          controlClass,
          "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
          disabled && "opacity-50",
        )}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label="减少"
          disabled={disabled || readOnly}
          onClick={() => handleStep(-1)}
          className={stepButtonClassName}
        >
          <Minus className="size-3" aria-hidden />
        </button>
        <div className="relative flex min-w-0 flex-1 items-center">
          {inputEl}
          {unitSuffix}
        </div>
        <button
          type="button"
          tabIndex={-1}
          aria-label="增加"
          disabled={disabled || readOnly}
          onClick={() => handleStep(1)}
          className={stepButtonClassName}
        >
          <Plus className="size-3" aria-hidden />
        </button>
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
