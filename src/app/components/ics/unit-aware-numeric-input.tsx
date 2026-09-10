import { NumericInput, type NumericInputProps } from "./numeric-input";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import {
  getDisplayLengthFamilyUnit,
  isLengthFamilyUnit,
  normalizeCanonicalLengthValue,
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
    ...rest
  } = props;

  if (!unit || !isLengthFamilyUnit(unit)) {
    return <NumericInput {...props} />;
  }

  // Omitted step → canonical 1mm (NumericInput default is 1 display unit; convert instead).
  const canonicalStep = step ?? 1;
  const cPrec = resolveCanonicalPrecision(precision, step);
  const dPrec = resolveDisplayPrecision(cPrec, display);

  const toCanonical = (v: number) =>
    normalizeCanonicalLengthValue(toCanonicalLengthValue(v, display), {
      min,
      max,
      precision: cPrec,
      step,
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
      snapToStep={false}
      onChange={onChange ? (v) => onChange(toCanonical(v)) : undefined}
      onCommit={onCommit ? (v) => onCommit(toCanonical(v)) : undefined}
    />
  );
};
