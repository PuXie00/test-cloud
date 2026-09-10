import type { DisplayAttribute } from "@shared/config";
import type { DisplayLengthUnit } from "@/app/project/display-length-units";
import type { MonitorPositions } from "./monitor-data";
import { formatMonitorDimension } from "./monitor-display";

/** Format object monitor H / P / Y line; null positions render as dashes. */
export const formatHpyLine = (
  positions: MonitorPositions | null,
  display: DisplayLengthUnit,
  hUnit: string = "mm",
): string => {
  if (!positions) return "— / — / —";
  const h = positions.h === undefined ? "—" : formatMonitorDimension(positions.h, hUnit, display);
  const p = positions.p === undefined ? "—" : formatMonitorDimension(positions.p, "°", display);
  const y = positions.y === undefined ? "—" : formatMonitorDimension(positions.y, "°", display);
  return `${h} / ${p} / ${y}`;
};

/** Format motor table numeric cells; null renders as em dash, zero as plain "0". */
export const formatMonitorNullableNumber = (value: number | null): string => {
  if (value === null) return "—";
  return String(value);
};

/** Format an extended state attribute value; enum maps to its label, missing renders as dash. */
export const formatExtendedValue = (
  attr: DisplayAttribute,
  value: number | null | undefined,
): string => {
  if (value === null || value === undefined) return "—";
  if (attr.dataType === "enum" && attr.values?.length) {
    return attr.values.find(([enumValue]) => enumValue === value)?.[1] ?? String(value);
  }
  return String(value);
};
