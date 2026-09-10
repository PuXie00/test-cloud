import type { DisplayAttribute } from "@shared/config";
import {
  formatLengthFamily,
  isLengthFamilyUnit,
  type DisplayLengthUnit,
} from "@/app/project/display-length-units";
import {
  displayPosition,
  telemetryStateValue,
  type MotorAlarmFlags,
} from "./build-debug-logic";
import { MOCK_STATE_IDS, type BuildMotorTelemetry } from "./build-debug-types";

/** 动态列：variable 且已通过 display:true 进入 catalog */
export const isVariableDisplayAttr = (attr: DisplayAttribute): boolean =>
  attr.type === "variable";

export const variablevariableStateAttri = (
  attrs: readonly DisplayAttribute[],
): DisplayAttribute[] => attrs.filter(isVariableDisplayAttr);

const formatUnit = (unit: string | undefined): string => {
  if (!unit) return "";
  if (unit === "degC") return "°";
  return unit;
};

/** 模拟 values 含该 id 则用其值；actualPosition 再减原点偏移 */
export const resolveStateAttrRawValue = (
  attrId: string,
  telemetry: BuildMotorTelemetry,
  originOffset = 0,
): number | null => {
  const raw = telemetryStateValue(telemetry, attrId);
  if (raw === undefined) return null;
  if (attrId === MOCK_STATE_IDS.actualPosition) {
    return displayPosition(raw, originOffset);
  }
  return raw;
};

export const formatStateAttrDisplay = (
  attr: DisplayAttribute,
  raw: number | null,
  displayUnit: DisplayLengthUnit = "mm",
): string => {
  if (raw === null || !Number.isFinite(raw)) return "—";

  if (attr.dataType === "enum" && attr.values?.length) {
    const hit = attr.values.find(([value]) => value === raw);
    return hit?.[1] ?? String(raw);
  }

  const attrUnit = attr.unit;
  if (attrUnit && isLengthFamilyUnit(attrUnit)) {
    return formatLengthFamily(raw, attrUnit, displayUnit, { canonicalPrecision: 1 });
  }

  const text = Number.isInteger(raw) ? String(raw) : raw.toFixed(0);
  const unit = formatUnit(attr.unit);
  if (!unit) return text;
  if (unit === "°") return `${text}°`;
  if (unit === "%") return `${text}%`;
  return text;
};

export const stateAttrToneClass = (
  attrId: string,
  alarms: MotorAlarmFlags,
): string => {
  if (attrId === MOCK_STATE_IDS.actualPosition) return "text-foreground";
  if (attrId === MOCK_STATE_IDS.actualTemperature && alarms.temperature) return "text-warning";
  if (attrId === MOCK_STATE_IDS.actualTorque && alarms.torqueImbalance) return "text-warning";
  return "text-muted-foreground";
};
