import type { BusNo } from "../components/right-sidebar/config-wizard/config-wizard-types";
import { isBusNo } from "./motor-bus";

type BusOrderedMotor = {
  id: number;
  plcId: number;
  busNo: BusNo;
};

/** 在已排除待插电机的列表中，计算某主控某从站口分组末尾的插入下标 */
export const insertIndexForBusEnd = (
  motors: readonly BusOrderedMotor[],
  plcId: number,
  busNo: BusNo,
): number => {
  let lastSameBus = -1;
  let lastPlc = -1;

  for (let index = 0; index < motors.length; index += 1) {
    const motor = motors[index]!;
    if (motor.plcId !== plcId) continue;
    lastPlc = index;
    if (motor.busNo === busNo) lastSameBus = index;
  }

  if (lastSameBus >= 0) return lastSameBus + 1;

  if (busNo === 0) {
    for (let index = 0; index < motors.length; index += 1) {
      const motor = motors[index]!;
      if (motor.plcId === plcId && motor.busNo === 1) return index;
    }
  }

  return lastPlc >= 0 ? lastPlc + 1 : motors.length;
};

/** 将电机列表追加到指定主控/从站口分组末尾 */
export const insertMotorsAtBusEnd = <M extends BusOrderedMotor>(
  motors: readonly M[],
  plcId: number,
  busNo: BusNo,
  inserted: readonly M[],
): M[] => {
  if (inserted.length === 0) return [...motors];
  const insertAt = insertIndexForBusEnd(motors, plcId, busNo);
  return [...motors.slice(0, insertAt), ...inserted, ...motors.slice(insertAt)];
};

/** 改从站口后抽到目标口分组末尾；busNo 一并写入 */
export const relocateMotorToBus = <M extends BusOrderedMotor>(
  motors: readonly M[],
  motorId: number,
  busNo: BusNo,
): M[] => {
  if (!isBusNo(busNo)) return [...motors];
  const index = motors.findIndex((motor) => motor.id === motorId);
  if (index < 0) return [...motors];
  const current = motors[index]!;
  const nextMotor = { ...current, busNo };
  const without = [...motors.slice(0, index), ...motors.slice(index + 1)];
  return insertMotorsAtBusEnd(without, current.plcId, busNo, [nextMotor]);
};
