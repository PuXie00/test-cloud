import { cn } from "@/app/components/ui/utils";
import { UnitAwareNumericInput } from "./unit-aware-numeric-input";
import {
  rangeInputBounds,
  type NumericRangeInputProps,
  type NumericRangeValue,
} from "./numeric-range-input";

export type UnitAwareNumericRangeInputProps = NumericRangeInputProps;
export type { NumericRangeValue };

export const UnitAwareNumericRangeInput = ({
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
  minCeiling,
  maxFloor,
}: UnitAwareNumericRangeInputProps) => {
  const sharedProps = { step, precision, unit, disabled, readOnly };
  const { minInputMax, maxInputMin } = rangeInputBounds({
    value,
    min,
    max,
    minCeiling,
    maxFloor,
    minMixed,
    maxMixed,
  });

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
      <UnitAwareNumericInput
        {...sharedProps}
        mixed={minMixed}
        value={value.min}
        min={min}
        max={minInputMax}
        onChange={handleMinChange}
        onCommit={handleMinCommit}
        className="[@media(pointer:coarse)]:h-10"
        aria-label={minAriaLabel}
      />
      <span aria-hidden className="font-mono text-mono-sm text-muted-foreground">
        —
      </span>
      <UnitAwareNumericInput
        {...sharedProps}
        mixed={maxMixed}
        value={value.max}
        min={maxInputMin}
        max={max}
        onChange={handleMaxChange}
        onCommit={handleMaxCommit}
        className="[@media(pointer:coarse)]:h-10"
        aria-label={maxAriaLabel}
      />
    </div>
  );
};
