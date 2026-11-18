import { NumericInput, type NumericInputProps } from "./numeric-input";
import { normalizeNumeric } from "./numeric-input-utils";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import {
  getDisplayLengthFamilyUnit,
  isLengthFamilyUnit,
  resolveCanonicalPrecision,
  resolveDisplayPrecision,
  scaleBound,
  toCanonicalLengthValue,
  toDisplayLengthValue,
} from "@/app/project/display-length-units";

export type UnitAwareNumericInputProps = NumericInputProps;

export const UnitAwareNumericInput = (props: UnitAwareNumericInputProps) => {
  const display = useSessionDisplayLengthUnit();
  const {
    unit,
    value = 0,
    onChange,
    onCommit,
    min,
    max,
    step,
    precision,
    snapToStep = true,
    ...rest
  } = props;

  if (!unit || !isLengthFamilyUnit(unit)) {
    return <NumericInput {...props} />;
  }

  // Omitted step → canonical 1mm (NumericInput default is 1 display unit; convert instead).
  const canonicalStep = step ?? 1;
  const cPrec = resolveCanonicalPrecision(precision, step);
  const dPrec = resolveDisplayPrecision(cPrec, display);

  // NumericInput already snapped drags / − + to the (display) step; typed values are only
  // rounded to precision. Re-snapping to the canonical step here would turn a typed 12.5 into 13,
  // so only clamp and round to the canonical precision — that also drops the display→mm
  // round-trip error (display precision carries ≥ log10(factor) extra digits).
  const toCanonical = (v: number) =>
    normalizeNumeric(toCanonicalLengthValue(v, display), {
      min,
      max,
      precision: cPrec,
      snapToStep: false,
    });

  return (
    <NumericInput
      {...rest}
      value={toDisplayLengthValue(value, display)}
      min={scaleBound(min, display, "toDisplay")}
      max={scaleBound(max, display, "toDisplay")}
      step={toDisplayLengthValue(canonicalStep, display)}
      precision={dPrec}
      unit={getDisplayLengthFamilyUnit(unit, display)}
      snapToStep={snapToStep}
      onChange={onChange ? (v) => onChange(toCanonical(v)) : undefined}
      onCommit={onCommit ? (v) => onCommit(toCanonical(v)) : undefined}
    />
  );
};
