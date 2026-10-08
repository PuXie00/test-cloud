import type { HoistTravelInput } from "@/app/viz3d";
import type { MotorMonitorSnapshot } from "../components/monitor-grid/monitor-data";
import type { Motor } from "../components/right-sidebar/config-wizard/config-wizard-types";
import {
  AXIS_TYPE,
  resolveAxisType,
} from "../components/right-sidebar/property-forms/motor-drive-params";

/** 已绑定吊点、在线且有实际位置的电机 → 搭建调试吊点显示输入；其余电机的吊点不显示 */
export const hoistTravelInputs = (
  motors: readonly Pick<Motor, "id" | "axisType" | "controlledObjectId">[],
  snapshots: readonly Pick<MotorMonitorSnapshot, "id" | "live" | "actualPosition">[],
): HoistTravelInput[] => {
  const positionById = new Map<number, number>();
  for (const snapshot of snapshots) {
    if (snapshot.live && snapshot.actualPosition !== null) {
      positionById.set(snapshot.id, snapshot.actualPosition);
    }
  }
  return motors.flatMap((motor): HoistTravelInput[] => {
    const position = positionById.get(motor.id);
    if (motor.controlledObjectId == null || position === undefined) return [];
    return [
      {
        motorId: String(motor.id),
        axisKind: resolveAxisType(motor.axisType) === AXIS_TYPE.continuous ? "rotary" : "linear",
        position,
      },
    ];
  });
};
