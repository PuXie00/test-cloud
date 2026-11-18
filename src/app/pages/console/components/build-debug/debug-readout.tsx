import type { DisplayAttribute } from "@shared/config";
import { cn } from "@/app/components/ui/utils";
import { formatLengthFamilyValue, type DisplayLengthUnit } from "@/app/project/display-length-units";
import {
  DEBUG_MOTION_PARAM_PRECISION,
  DEBUG_POSITION_PRECISION,
  DEBUG_POSITION_UNIT,
  DEBUG_SPEED_UNIT,
} from "./build-debug-display";
import { telemetryStateValue } from "./build-debug-logic";
import { MOCK_STATE_IDS, type BuildMotorTelemetry } from "./build-debug-types";

export type DebugReadoutMeta = { prefix: string; label: string };

/**
 * 调试页实时数据的短前缀：「p: 位置」「s: 速度」…，窄列和 3D 徽章里都放得下。
 * 力矩取 m、温度取 t（力矩 M、摄氏温度 t 的习惯符号，统一小写），全称放在 title。
 */
export const DEBUG_READOUTS: Readonly<Record<string, DebugReadoutMeta>> = {
  [MOCK_STATE_IDS.actualPosition]: { prefix: "p", label: "位置" },
  [MOCK_STATE_IDS.actualSpeed]: { prefix: "s", label: "速度" },
  [MOCK_STATE_IDS.actualTemperature]: { prefix: "t", label: "温度" },
  [MOCK_STATE_IDS.actualTorque]: { prefix: "m", label: "力矩" },
  [MOCK_STATE_IDS.actualWeight]: { prefix: "w", label: "称重" },
  actualLoadRate: { prefix: "l", label: "负载率" },
  driveAlarmCode: { prefix: "e", label: "驱动报警码" },
};

/** 列表固定列（位置 / 速度 / 温度 / 力矩）；描述文件里同 id 的 variable 字段不再重复成列 */
export const DEBUG_FIXED_READOUT_IDS: ReadonlySet<string> = new Set([
  MOCK_STATE_IDS.actualPosition,
  MOCK_STATE_IDS.actualSpeed,
  MOCK_STATE_IDS.actualTemperature,
  MOCK_STATE_IDS.actualTorque,
]);

/** 没约定字母的描述文件字段用它自己的名称作前缀，形式仍是「前缀: 值」 */
export const debugReadoutMeta = (attr: Pick<DisplayAttribute, "id" | "label">): DebugReadoutMeta =>
  DEBUG_READOUTS[attr.id] ?? { prefix: attr.label, label: attr.label };

const readoutOf = (id: string): DebugReadoutMeta => DEBUG_READOUTS[id]!;

export const POSITION_READOUT = readoutOf(MOCK_STATE_IDS.actualPosition);
export const SPEED_READOUT = readoutOf(MOCK_STATE_IDS.actualSpeed);
export const TEMPERATURE_READOUT = readoutOf(MOCK_STATE_IDS.actualTemperature);
export const TORQUE_READOUT = readoutOf(MOCK_STATE_IDS.actualTorque);

/** 显示位置（已减原点偏移），会话长度单位，精度同移动目标 */
export const formatDebugPositionReadout = (
  displayPosition: number,
  displayUnit: DisplayLengthUnit,
): string =>
  formatLengthFamilyValue(displayPosition, DEBUG_POSITION_UNIT, displayUnit, {
    canonicalPrecision: DEBUG_POSITION_PRECISION,
  });

/** 实际速度，会话长度单位 /s；遥测没给就是「—」 */
export const formatDebugSpeedReadout = (
  telemetry: BuildMotorTelemetry,
  displayUnit: DisplayLengthUnit,
): string => {
  const speed = telemetryStateValue(telemetry, MOCK_STATE_IDS.actualSpeed);
  if (speed === undefined) return "—";
  return formatLengthFamilyValue(speed, DEBUG_SPEED_UNIT, displayUnit, {
    canonicalPrecision: DEBUG_MOTION_PARAM_PRECISION.defaultVelocity,
  });
};

type DebugReadoutProps = {
  meta: DebugReadoutMeta;
  value: string;
  /** 数值的色调（告警等）；前缀始终弱化 */
  valueClassName?: string;
  className?: string;
};

/** 「p: 123.4」：前缀弱化紧贴数值，不换行 */
export const DebugReadout = ({ meta, value, valueClassName, className }: DebugReadoutProps) => (
  <span
    className={cn("whitespace-nowrap font-mono text-mono-sm tabular-nums", className)}
    title={meta.label}
    data-readout={meta.prefix}
  >
    <span className="text-muted-foreground">{meta.prefix}:</span>{" "}
    <span className={valueClassName}>{value}</span>
  </span>
);
