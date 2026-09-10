import type { BusNo, Motor, Plc } from "../components/right-sidebar/config-wizard/config-wizard-types";
import { getCachedPlcModelConfig } from "./motor-config";

export type PlcBusLimits = {
  maxAxisPerC: number;
  maxAxisPerD: number;
};

export const DEFAULT_BUS_NO: BusNo = 0;

export const isBusNo = (value: unknown): value is BusNo => value === 0 || value === 1;

export const busNoLabel = (busNo: BusNo): string => (busNo === 0 ? "C口" : "D口");

/** catalog 未加载时返回 null（跳过容量硬限制） */
export const getPlcBusLimits = (masterTypeId: string): PlcBusLimits | null => {
  const config = getCachedPlcModelConfig(masterTypeId);
  if (!config) return null;
  const maxAxisPerC = Number(config.hardware.maxAxisPerC);
  const maxAxisPerD = Number(config.hardware.maxAxisPerD);
  return {
    maxAxisPerC: Number.isFinite(maxAxisPerC) ? maxAxisPerC : 0,
    maxAxisPerD: Number.isFinite(maxAxisPerD) ? maxAxisPerD : 0,
  };
};

export const getPlcBusLimitsForPlc = (
  plcId: number,
  plcs: readonly Plc[],
): PlcBusLimits | null => {
  const plc = plcs.find((item) => item.id === plcId);
  if (!plc) return null;
  return getPlcBusLimits(plc.masterTypeId);
};

export const countMotorsOnBus = (
  motors: readonly Pick<Motor, "plcId" | "busNo" | "id">[],
  plcId: number,
  busNo: BusNo,
  excludeMotorId?: number,
): number =>
  motors.filter(
    (motor) =>
      motor.plcId === plcId &&
      motor.busNo === busNo &&
      (excludeMotorId === undefined || motor.id !== excludeMotorId),
  ).length;

export const remainingBusSlots = (
  motors: readonly Pick<Motor, "plcId" | "busNo" | "id">[],
  plcId: number,
  busNo: BusNo,
  limits: PlcBusLimits | null,
  excludeMotorId?: number,
): number => {
  if (!limits) return Number.POSITIVE_INFINITY;
  const max = busNo === 0 ? limits.maxAxisPerC : limits.maxAxisPerD;
  return Math.max(0, max - countMotorsOnBus(motors, plcId, busNo, excludeMotorId));
};

export const canPlaceMotorsOnBus = (
  motors: readonly Pick<Motor, "plcId" | "busNo" | "id">[],
  plcId: number,
  busNo: BusNo,
  limits: PlcBusLimits | null,
  options?: { count?: number; excludeMotorId?: number },
): boolean => {
  const count = options?.count ?? 1;
  if (count <= 0) return true;
  return remainingBusSlots(motors, plcId, busNo, limits, options?.excludeMotorId) >= count;
};
