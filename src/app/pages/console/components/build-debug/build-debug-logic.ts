import type { MotorMonitorSnapshot } from "../monitor-grid/monitor-data";
import { motorRuntimeStatusFromAxisCode } from "../monitor-grid/monitor-status";
import {
  MOCK_STATE_IDS,
  TEMPERATURE_ALARM_C,
  TORQUE_IMBALANCE_THRESHOLD,
  type BuildMotorTelemetry,
  type MotorRuntimeStatus,
} from "./build-debug-types";

export const displayPosition = (rawPosition: number, originOffset: number): number =>
  rawPosition - originOffset;

export const telemetryStateValue = (
  telemetry: BuildMotorTelemetry,
  attrId: string,
): number | undefined => {
  const value = telemetry.values[attrId];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

/** 同物体电机力矩极差超阈值 → 返回偏离中位数的电机 id */
export const imbalancedTorqueMotorIds = (
  loads: ReadonlyArray<{ id: number; torque: number }>,
): number[] => {
  if (loads.length < 2) return [];
  const values = loads.map((item) => item.torque);
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max - min <= TORQUE_IMBALANCE_THRESHOLD) return [];
  const base = median(values);
  return loads
    .filter((item) => Math.abs(item.torque - base) > TORQUE_IMBALANCE_THRESHOLD / 2)
    .map((item) => item.id);
};

export type MotorAlarmFlags = {
  temperature: boolean;
  torqueImbalance: boolean;
  driveAlarm: boolean;
  any: boolean;
};

export const evaluateMotorAlarms = (
  telemetry: BuildMotorTelemetry,
  imbalancedIds: ReadonlySet<number>,
  motorId: number,
): MotorAlarmFlags => {
  const temperature =
    (telemetryStateValue(telemetry, MOCK_STATE_IDS.actualTemperature) ?? 0) >= TEMPERATURE_ALARM_C;
  const torqueImbalance = imbalancedIds.has(motorId);
  const driveAlarm = (telemetryStateValue(telemetry, "driveAlarmCode") ?? 0) !== 0;
  return { temperature, torqueImbalance, driveAlarm, any: temperature || torqueImbalance || driveAlarm };
};

/** 从轮询快照派生电机运行态：axisStatus 0 断电 / 1 错误 / 2 静止 / 3 运动 */
export const motorStatusFromSnapshot = (snapshot: MotorMonitorSnapshot): MotorRuntimeStatus =>
  motorRuntimeStatusFromAxisCode(snapshot.axisStatus);

/** 从轮询快照派生调试面板遥测（status + values） */
export const telemetryFromSnapshot = (
  snapshot: MotorMonitorSnapshot | undefined,
): BuildMotorTelemetry => {
  if (!snapshot) return { status: "powerOff", values: {} };
  const values: Record<string, number> = {};
  if (snapshot.actualPosition !== null) values[MOCK_STATE_IDS.actualPosition] = snapshot.actualPosition;
  if (snapshot.actualTemperature !== null) values[MOCK_STATE_IDS.actualTemperature] = snapshot.actualTemperature;
  if (snapshot.actualTorque !== null) values[MOCK_STATE_IDS.actualTorque] = snapshot.actualTorque;
  if (snapshot.actualWeight !== null) values[MOCK_STATE_IDS.actualWeight] = snapshot.actualWeight;
  if (snapshot.actualSpeed !== null) values["actualSpeed"] = snapshot.actualSpeed;
  if (snapshot.actualLoadRate !== null) values["actualLoadRate"] = snapshot.actualLoadRate;
  if (snapshot.driveAlarmCode !== null) values["driveAlarmCode"] = snapshot.driveAlarmCode;
  return { status: motorStatusFromSnapshot(snapshot), values };
};
