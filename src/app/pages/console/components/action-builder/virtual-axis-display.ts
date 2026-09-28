import type { VirtualAxisId, VirtualAxisValues } from "@/app/project/project-document-types";
import {
  formatLengthFamily,
  formatLengthFamilyValue,
  getDisplayLengthFamilyUnit,
  isLengthFamilyUnit,
  toCanonicalLengthValue,
  toDisplayLengthValue,
  type DisplayLengthUnit,
  type FormatLengthFamilyOptions,
} from "@/app/project/display-length-units";
import { virtualAxisDescriptor } from "@/app/project/virtual-axis-mapping";
import { CONTROL_TYPE_RULES } from "@/app/project/configuration-rules";
import type { ControlType, MotionAxisKind } from "@/app/project/configuration-types";

/** 虚轴 2、虚轴 3 的编辑步进是 0.1，标签最多显示一位小数。虚轴 1 的角度仍保留两位。 */
const plainNumberPrecision = (axis: VirtualAxisId): number => (axis === "v1" ? 2 : 1);

const formatPlainNumber = (value: number, axis: VirtualAxisId): string => {
  const text = value.toFixed(plainNumberPrecision(axis));
  const rounded = Number(text);
  if (!Number.isFinite(rounded)) return text;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(plainNumberPrecision(axis));
};

const DEFAULT_MOTION_AXES = ["move"] as const;

const motionAxesForControlType = (
  controlType?: ControlType,
): readonly MotionAxisKind[] =>
  controlType ? CONTROL_TYPE_RULES[controlType].motionAxes : DEFAULT_MOTION_AXES;

export const getVirtualAxisMeta = (
  axis: VirtualAxisId,
  controlType?: ControlType,
): { label: string; unit: string } => {
  const { label, unit } = virtualAxisDescriptor(motionAxesForControlType(controlType), axis);
  return { label, unit };
};

export const getVirtualAxisCanonicalUnit = (
  axis: VirtualAxisId,
  controlType?: ControlType,
): string => getVirtualAxisMeta(axis, controlType).unit;

export const isLengthFamilyVirtualAxis = (
  axis: VirtualAxisId,
  controlType?: ControlType,
): boolean => isLengthFamilyUnit(getVirtualAxisCanonicalUnit(axis, controlType));

export const getVirtualAxisDisplayUnit = (
  axis: VirtualAxisId,
  display: DisplayLengthUnit,
  controlType?: ControlType,
): string => {
  const canonical = getVirtualAxisCanonicalUnit(axis, controlType);
  return isLengthFamilyUnit(canonical)
    ? getDisplayLengthFamilyUnit(canonical, display)
    : canonical;
};

export const toDisplayAxisValue = (
  axis: VirtualAxisId,
  canonicalValue: number,
  display: DisplayLengthUnit,
  controlType?: ControlType,
): number => {
  if (!isLengthFamilyVirtualAxis(axis, controlType)) return canonicalValue;
  return toDisplayLengthValue(canonicalValue, display);
};

export const toCanonicalAxisValue = (
  axis: VirtualAxisId,
  displayValue: number,
  display: DisplayLengthUnit,
  controlType?: ControlType,
): number => {
  if (!isLengthFamilyVirtualAxis(axis, controlType)) return displayValue;
  return toCanonicalLengthValue(displayValue, display);
};

export const formatVirtualAxisValue = (
  axis: VirtualAxisId,
  canonicalValue: number,
  display: DisplayLengthUnit,
  options: FormatLengthFamilyOptions = { canonicalPrecision: 1 },
  controlType?: ControlType,
): string => {
  const unit = getVirtualAxisCanonicalUnit(axis, controlType);
  if (isLengthFamilyUnit(unit)) {
    return formatLengthFamily(canonicalValue, unit, display, options);
  }
  return `${formatPlainNumber(canonicalValue, axis)} ${unit}`;
};

export const formatVirtualAxisSpeed = (
  axis: VirtualAxisId,
  canonicalSpeed: number,
  display: DisplayLengthUnit,
  options: FormatLengthFamilyOptions = { canonicalPrecision: 1 },
  controlType?: ControlType,
): string => {
  if (isLengthFamilyVirtualAxis(axis, controlType)) {
    return formatLengthFamily(canonicalSpeed, "mm/s", display, options);
  }
  const unit = getVirtualAxisCanonicalUnit(axis, controlType);
  return `${formatPlainNumber(canonicalSpeed, axis)} ${unit}/s`;
};

export const formatVirtualAxisCompact = (
  axis: VirtualAxisId,
  canonicalValue: number,
  display: DisplayLengthUnit,
  options: FormatLengthFamilyOptions = { canonicalPrecision: 1 },
  controlType?: ControlType,
): string => {
  const unit = getVirtualAxisCanonicalUnit(axis, controlType);
  if (isLengthFamilyUnit(unit)) {
    const value = formatLengthFamilyValue(canonicalValue, unit, display, options);
    return `${value}${getDisplayLengthFamilyUnit(unit, display)}`;
  }
  return `${formatPlainNumber(canonicalValue, axis)}${unit}`;
};

export const formatVirtualAxesCompact = (
  axes: readonly VirtualAxisId[],
  values: VirtualAxisValues,
  display: DisplayLengthUnit,
  options: FormatLengthFamilyOptions = { canonicalPrecision: 1 },
  controlType?: ControlType,
): string =>
  axes
    .filter((axis) => {
      const value = values[axis];
      return value !== undefined && Number.isFinite(value);
    })
    .map((axis) =>
      formatVirtualAxisCompact(axis, values[axis]!, display, options, controlType),
    )
    .join("/");
