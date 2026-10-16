import {
  formatLengthFamilyValue,
  getDisplayLengthFamilyUnit,
  isLengthFamilyUnit,
  type DisplayLengthUnit,
} from "@/app/project/display-length-units";
import {
  MAX_PROJECT_COORDINATE_DECIMALS,
  roundProjectCoordinate,
} from "@/app/project/project-quantity";

const formatNumber = (value: number): string => {
  const rounded = roundProjectCoordinate(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

/** Length-family values follow the display unit; angles keep their canonical unit. */
export const formatQuantityValue = (
  value: number,
  canonicalUnit: string,
  display: DisplayLengthUnit,
): string =>
  isLengthFamilyUnit(canonicalUnit)
    ? formatLengthFamilyValue(roundProjectCoordinate(value), canonicalUnit, display, {
        canonicalPrecision: MAX_PROJECT_COORDINATE_DECIMALS,
      })
    : formatNumber(value);

export const formatQuantity = (
  value: number,
  canonicalUnit: string,
  display: DisplayLengthUnit,
): string =>
  `${formatQuantityValue(value, canonicalUnit, display)} ${getDisplayLengthFamilyUnit(canonicalUnit, display)}`;
