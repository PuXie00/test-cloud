import type { BusNo } from "../components/right-sidebar/config-wizard/config-wizard-types";
import { isBusNo } from "./motor-bus";
import { resolveMotorModelName } from "./motor-config";
import {
  SETUP_ENTITY_ID_MAX,
  SETUP_ENTITY_ID_MIN,
  allocateSetupEntityIds,
  allocateSetupEntityIdsInProject,
  isValidSetupEntityId,
} from "./setup-entity-id";

/** @deprecated 使用 SETUP_ENTITY_ID_* / isValidSetupEntityId */
export const MOTOR_MID_MIN = SETUP_ENTITY_ID_MIN;
export const MOTOR_MID_MAX = SETUP_ENTITY_ID_MAX;
/** @deprecated 使用 isValidSetupEntityId */
export const isValidMotorMid = isValidSetupEntityId;

type MotorLabelSource = {
  id: number;
  plcId: number;
  productModel: string;
  busNo: BusNo;
};

/** 从站口字母：C / D（用于显示名） */
export const busNoCode = (busNo: BusNo): "C" | "D" => (busNo === 0 ? "C" : "D");

/** 所属主控 + 从站口下按 motors 数组顺序的显示索引（从 0 起） */
export const getMotorDisplayIndex = (
  motors: readonly Pick<MotorLabelSource, "id" | "plcId" | "busNo">[],
  motorId: number,
): number => {
  const target = motors.find((motor) => motor.id === motorId);
  if (!target || !isBusNo(target.busNo)) return 0;
  let index = 0;
  for (const motor of motors) {
    if (motor.plcId !== target.plcId || motor.busNo !== target.busNo) continue;
    if (motor.id === motorId) return index;
    index += 1;
  }
  return 0;
};

/** 电机显示名（不入库）：{型号 name}-{C|D}-{同口 index} */
export const formatMotorLabel = (
  productModel: string,
  busNo: BusNo,
  index: number,
): string => `${resolveMotorModelName(productModel)}-${busNoCode(busNo)}-${index + 1}`;

/** 按工程电机列表计算显示名 */
export const formatMotorDisplayName = (
  motors: readonly MotorLabelSource[],
  motor: MotorLabelSource | number,
): string => {
  const id = typeof motor === "number" ? motor : motor.id;
  const resolved = typeof motor === "number" ? motors.find((item) => item.id === id) : motor;
  if (!resolved) return String(id);
  const busNo = isBusNo(resolved.busNo) ? resolved.busNo : 0;
  return formatMotorLabel(
    resolved.productModel,
    busNo,
    getMotorDisplayIndex(motors, id),
  );
};

/** @deprecated 使用 allocateSetupEntityIds */
export const allocateMotorMids = allocateSetupEntityIds;

/** @deprecated 使用 allocateSetupEntityIdsInProject */
export const allocateMotorMidsInProject = (
  motors: readonly { id?: number }[],
  count: number,
): number[] => allocateSetupEntityIdsInProject({ motors }, count);

/** @deprecated 电机 id 即实体 id，不再单独补 mid */
export const ensureMotorMids = <M extends { id?: unknown }>(motors: readonly M[]): M[] =>
  motors.map((motor) => ({ ...motor }));
