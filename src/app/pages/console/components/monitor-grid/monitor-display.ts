import {
  formatLengthFamily,
  isLengthFamilyUnit,
  type DisplayLengthUnit,
} from "@/app/project/display-length-units";

/** Format monitor/detail dimension values; angles and other units pass through. */
export const formatMonitorDimension = (
  value: number,
  canonicalUnit: string,
  display: DisplayLengthUnit,
  options?: { canonicalPrecision?: number },
): string => {
  if (!Number.isFinite(value)) return "—";
  if (isLengthFamilyUnit(canonicalUnit)) {
    return formatLengthFamily(value, canonicalUnit, display, {
      canonicalPrecision: options?.canonicalPrecision ?? 1,
    });
  }
  const precision = options?.canonicalPrecision ?? 1;
  return `${value.toFixed(precision)} ${canonicalUnit}`;
};

/** Format monitor card / detail drive speed (canonical mm/s). */
export const formatMonitorSpeed = (
  speedMmPerS: number,
  display: DisplayLengthUnit,
): string => formatLengthFamily(speedMmPerS, "mm/s", display, { canonicalPrecision: 1 });
