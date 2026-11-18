import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "./utils";
import { controlClass } from "@/app/components/ui/forms/form-tokens";
import {
  isCompleteNumericText,
  resolveInputPrecision,
  roundToInputPrecision,
  sanitizeNumericDraft,
} from "./input-numeric";
import { setInputValueAsUser, useFieldEdit } from "./field-edit";

export type InputProps = Omit<React.ComponentProps<"input">, "readOnly"> & {
  showStepper?: boolean;
  readOnly?: boolean;
  /** 内嵌在输入框右侧的单位后缀（仅 showStepper 数字输入生效） */
  unit?: string;
  /** 获得焦点时全选当前值（点击、触摸、Tab），同 NumericInput。默认开 */
  selectOnFocus?: boolean;
  /**
   * Esc 放弃本次修改：值回到获得焦点（或上次回车）时的样子并离开输入框，同 NumericInput。默认开；
   * 聊天类输入框不想按 Esc 丢掉已打的字时关掉。
   */
  revertOnEscape?: boolean;
  /**
   * 数字输入允许的小数位数。`0` 为整数。
   * 未传时：`type="number"` 默认整数；若 `step` 带小数则按 step 推断。
   */
  precision?: number;
  /**
   * − + 按档位改值（仅 showStepper 生效）：给了它，点 − + 调用 onStep(∓1)，由父组件写入，
   * 不再按 step 加减后触发 onChange。用于值只能取离散档位的场合。
   */
  onStep?: (delta: number) => void;
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
      selectOnFocus = true,
      revertOnEscape = true,
      onFocus,
      onBlur,
      onKeyDown,
      onMouseDown,
      onMouseUp,
      precision,
      onStep,
      ...props
    },
    ref,
  ) => {
    const isStepper = type === "number" && showStepper;
    const isNumeric = type === "number";
    const resolvedPrecision = resolveInputPrecision(precision, step);
    // 受控数字框才有草稿；不受控（register）的由浏览器自己保留文字
    const hasDraft = isNumeric && value !== undefined;
    const valueText = value == null ? "" : String(value);
    /**
     * 数字框键入中的文字，null = 显示 value。同 NumericInput 的草稿：键入时框里显示自己打的字，
     * 不被外面回写的值盖掉（外面常写 Number(e.target.value)：清空会变回 "0"、再打成 "05"，删不掉）。
     * 每次改动照旧通知外面（含 "" 等中间态）：执行 / 应用类按钮读的仍是用户看到的内容，
     * 不会因为草稿而拿旧值去动设备。离开输入框、回车后显示外面的值。
     */
    const [draft, setDraft] = React.useState<string | null>(null);
    /** Esc 回到的值：获得焦点时（或上次回车提交时）的值 */
    const revertTextRef = React.useRef<string | null>(null);

    const fieldEdit = useFieldEdit({
      selectOnFocus,
      onCommitKey: (event) => {
        setDraft(null);
        revertTextRef.current = hasDraft ? valueText : event.currentTarget.value;
      },
      onCancelKey: (event) => {
        const input = event.currentTarget;
        if (!revertOnEscape || input.readOnly || input.matches(":disabled")) return;
        const original = revertTextRef.current;
        // 数字框回不到“空”（多选不一致时显示空）：外面会把 "" 当 0 写进去，交给外层（如 ProjectEditBoundary）取消
        const canRevert =
          original != null && (!isNumeric || isCompleteNumericText(original));
        if (canRevert && input.value !== original) {
          setInputValueAsUser(input, original);
        }
        setDraft(null);
        // 外层（ProjectEditBoundary 的 Esc 取消）先处理完这次按键，再离开输入框
        queueMicrotask(() => {
          if (document.activeElement === input) input.blur();
        });
      },
    });

    const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
      revertTextRef.current = event.currentTarget.value;
      setDraft(null);
      fieldEdit.onFocus(event);
      onFocus?.(event);
    };

    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      setDraft(null);
      revertTextRef.current = null;
      onBlur?.(event);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      const noModifier = !event.ctrlKey && !event.metaKey && !event.altKey;
      // 数字框：浏览器放行 "e"；整数字段里 Chrome 把 "1." 报成 "1"，草稿过滤拦不住小数点。这两个键直接不收
      if (
        isNumeric &&
        noModifier &&
        (event.key === "e" || event.key === "E" || (resolvedPrecision === 0 && event.key === "."))
      ) {
        event.preventDefault();
      }
      fieldEdit.onKeyDown(event);
      onKeyDown?.(event);
    };

    const handleMouseDown = (event: React.MouseEvent<HTMLInputElement>) => {
      fieldEdit.onMouseDown(event);
      onMouseDown?.(event);
    };

    const handleMouseUp = (event: React.MouseEvent<HTMLInputElement>) => {
      fieldEdit.onMouseUp(event);
      onMouseUp?.(event);
    };

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!isNumeric) {
        onChange?.(event);
        return;
      }
      const sanitized = sanitizeNumericDraft(event.target.value, resolvedPrecision);
      if (sanitized == null) {
        event.target.value = draft ?? valueText;
        return;
      }
      if (event.target.value !== sanitized) {
        event.target.value = sanitized;
      }
      if (hasDraft) {
        setDraft(sanitized);
      }
      onChange?.(event);
    };

    const handleStep = (delta: number) => {
      if (disabled || readOnly) return;
      setDraft(null);
      if (onStep) {
        onStep(delta);
        return;
      }
      if (!onChange) return;
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
        value={hasDraft && draft != null ? draft : value}
        onChange={handleChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
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
