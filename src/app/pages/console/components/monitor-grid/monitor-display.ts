import { withoutNegativeZero } from "@/app/pages/console/components/action-builder/virtual-axis-display";
import {
  formatLengthFamily,
  formatLengthFamilyValue,
  getDisplayLengthFamilyUnit,
  isLengthFamilyUnit,
  type DisplayLengthUnit,
} from "@/app/project/display-length-units";

/**
 * 监控里的虚轴值一律保留一位小数，不去掉末尾的 0，也不显示 -0.0，和 3D 视口的虚轴标签一致。
 * 长度切到 cm / m / in 时按原来的精度换算（如 1.2340 m），不丢精度，只是同样不去零。
 */
export const formatMonitorDimension = (
  value: number,
  canonicalUnit: string,
  display: DisplayLengthUnit,
  options?: { canonicalPrecision?: number },
): string => {
  if (!Number.isFinite(value)) return "—";
  const precision = options?.canonicalPrecision ?? 1;
  if (isLengthFamilyUnit(canonicalUnit)) {
    const text = formatLengthFamilyValue(value, canonicalUnit, display, {
      canonicalPrecision: precision,
      trimTrailingZeros: false,
    });
    return `${withoutNegativeZero(text)} ${getDisplayLengthFamilyUnit(canonicalUnit, display)}`;
  }
  return `${withoutNegativeZero(value.toFixed(precision))} ${canonicalUnit}`;
};

/** Format monitor card / detail drive speed (canonical mm/s). */
export const formatMonitorSpeed = (
  speedMmPerS: number,
  display: DisplayLengthUnit,
): string => formatLengthFamily(speedMmPerS, "mm/s", display, { canonicalPrecision: 1 });
