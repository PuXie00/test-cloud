import type { HoistTravelDirection, HoistTravelInput } from "@/app/viz3d";
import type { MotorMonitorSnapshot } from "../components/monitor-grid/monitor-data";
import type { Motor } from "../components/right-sidebar/config-wizard/config-wizard-types";
import {
  AXIS_TYPE,
  MOTOR_DRIVE_PARAM_IDS,
  resolveAxisType,
} from "../components/right-sidebar/property-forms/motor-drive-params";

/** 驱动参数 axisDirection：0 正向，1 反向；缺省按正向（与下发 PLC 的取值一致） */
const AXIS_DIRECTION_REVERSE = 1;

const axisDirectionOf = (params: Motor["params"] | undefined): HoistTravelDirection =>
  Number(params?.[MOTOR_DRIVE_PARAM_IDS.axisDirection]) === AXIS_DIRECTION_REVERSE
    ? "reverse"
    : "forward";

/** 已绑定吊点、在线且有实际位置的电机 → 搭建调试吊点显示输入；其余电机的吊点不显示 */
export const hoistTravelInputs = (
  motors: readonly Pick<Motor, "id" | "axisType" | "controlledObjectId" | "params">[],
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
        direction: axisDirectionOf(motor.params),
        position,
      },
    ];
  });
};
