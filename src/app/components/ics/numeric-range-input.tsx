import { cn } from "@/app/components/ui/utils";
import { NumericInput } from "./numeric-input";

export type NumericRangeValue = {
  min: number;
  max: number;
};

export type NumericRangeInputProps = {
  value: NumericRangeValue;
  onChange?: (value: NumericRangeValue) => void;
  onCommit?: (value: NumericRangeValue) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  unit?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  minAriaLabel?: string;
  maxAriaLabel?: string;
  /** 批量编辑：下限值不一致时显示混合态 */
  minMixed?: boolean;
  /** 批量编辑：上限值不一致时显示混合态 */
  maxMixed?: boolean;
};

export const NumericRangeInput = ({
  value,
  onChange = () => {},
  onCommit,
  min,
  max,
  step,
  precision,
  unit,
  disabled,
  readOnly,
  className,
  minAriaLabel = "最小值",
  maxAriaLabel = "最大值",
  minMixed = false,
  maxMixed = false,
}: NumericRangeInputProps) => {
  const sharedProps = { step, precision, unit, disabled, readOnly };
  const minUpperBound = maxMixed || max == null ? value.max : Math.min(value.max, max);
  const maxLowerBound = minMixed || min == null ? value.min : Math.max(value.min, min);

  const handleMinChange = (next: number) => {
    onChange({ min: next, max: value.max });
  };
  const handleMaxChange = (next: number) => {
    onChange({ min: value.min, max: next });
  };
  const handleMinCommit = (next: number) => {
    onCommit?.({ min: next, max: value.max });
  };
  const handleMaxCommit = (next: number) => {
    onCommit?.({ min: value.min, max: next });
  };

  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2",
        className,
      )}
    >
      <NumericInput
        {...sharedProps}
        mixed={minMixed}
        value={value.min}
        min={min}
        max={minMixed ? max : minUpperBound}
        onChange={handleMinChange}
        onCommit={handleMinCommit}
        className="[@media(pointer:coarse)]:h-10"
        aria-label={minAriaLabel}
      />
      <span aria-hidden className="font-mono text-mono-sm text-muted-foreground">
        —
      </span>
      <NumericInput
        {...sharedProps}
        mixed={maxMixed}
        value={value.max}
        min={maxMixed ? min : maxLowerBound}
        max={max}
        onChange={handleMaxChange}
        onCommit={handleMaxCommit}
        className="[@media(pointer:coarse)]:h-10"
        aria-label={maxAriaLabel}
      />
    </div>
  );
};
