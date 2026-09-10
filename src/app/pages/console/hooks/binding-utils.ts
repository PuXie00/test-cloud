import type { ControlType } from "@/app/project/configuration-types";
import {
  controlTypeHasNoDriveAxes,
  ensureMinimumDriveAxes,
} from "@/app/project/configuration-rules";
import { mergeTemplateAxes } from "../components/right-sidebar/config-wizard/axis-utils";
import type {
  BusNo,
  ControlledObject,
  Motor,
} from "../components/right-sidebar/config-wizard/config-wizard-types";
import {
  AXIS_TYPE,
  resolveAxisType,
  type AxisTypeCode,
} from "../components/right-sidebar/property-forms/motor-drive-params";

/** 物体控制类型要求的电机轴类型；目前仅无极旋转模型需要无极旋转轴 */
export const requiredAxisTypeForControlType = (
  controlType: ControlType,
): AxisTypeCode =>
  controlType === "continuousRotation" ? AXIS_TYPE.continuous : AXIS_TYPE.linear;

export const axisTypeLabel = (axisType: AxisTypeCode): string =>
  axisType === AXIS_TYPE.continuous ? "无极旋转轴" : "线性轴";

/** 解绑后的默认轴类型 */
export const unboundMotorAxisType = (): AxisTypeCode => AXIS_TYPE.linear;

export const bindMotorToAxis = (
  motor: Motor,
  objectId: number,
  axisKey: string,
  controlType: ControlType,
): Motor => ({
  ...motor,
  controlledObjectId: objectId,
  axisKey,
  axisType: requiredAxisTypeForControlType(controlType),
});

export const unbindMotor = (motor: Motor): Motor => ({
  ...motor,
  controlledObjectId: null,
  axisKey: null,
  axisType: unboundMotorAxisType(),
});

/**
 * 变更控制类型后仍保留绑定、且 axisType 需要改写的电机数量。
 * 切到无驱动轴类型时返回 0（走独立确认，解绑时再回线性）。
 */
export const countBoundMotorsNeedingAxisTypeChange = (
  object: ControlledObject,
  motors: readonly Motor[],
  nextControlType: ControlType,
): number => {
  if (controlTypeHasNoDriveAxes(nextControlType)) return 0;
  const required = requiredAxisTypeForControlType(nextControlType);
  const templateKeys = ensureMinimumDriveAxes(nextControlType, []).map((axis) => ({
    key: axis.key,
  }));
  const nextKeys = new Set(
    mergeTemplateAxes(nextControlType, templateKeys, object.axes).map((axis) => axis.key),
  );
  let count = 0;
  for (const motor of motors) {
    if (motor.controlledObjectId !== object.id || !motor.axisKey) continue;
    if (!nextKeys.has(motor.axisKey)) continue;
    if (getMotorAxisType(motor) !== required) count += 1;
  }
  return count;
};

export type AxisBindingRef = {
  objectId: number;
  axisKey: string;
  motorId: number;
};

/** 电机侧为绑定唯一真相：controlledObjectId + axisKey */
export const findMotorForAxis = (
  objectId: number,
  axisKey: string,
  motors: readonly Motor[],
): Motor | undefined =>
  motors.find(
    (motor) => motor.controlledObjectId === objectId && motor.axisKey === axisKey,
  );

export const getMotorIdForAxis = (
  objectId: number,
  axisKey: string,
  motors: readonly Motor[],
): number | null => findMotorForAxis(objectId, axisKey, motors)?.id ?? null;

export const isAxisBound = (
  objectId: number,
  axisKey: string,
  motors: readonly Motor[],
): boolean => getMotorIdForAxis(objectId, axisKey, motors) !== null;

export const countBoundAxesOnObject = (
  object: ControlledObject,
  motors: readonly Motor[],
): number =>
  object.axes.reduce(
    (count, axis) => count + (isAxisBound(object.id, axis.key, motors) ? 1 : 0),
    0,
  );

export const objectHasUnboundAxes = (
  object: ControlledObject,
  motors: readonly Motor[],
): boolean => object.axes.some((axis) => !isAxisBound(object.id, axis.key, motors));

export const getMotorAxisType = (motor: Motor): AxisTypeCode =>
  resolveAxisType(motor.axisType);

export const listAxisBindingsFromMotors = (
  motors: readonly Motor[],
): AxisBindingRef[] =>
  motors.flatMap((motor) =>
    motor.controlledObjectId != null && motor.axisKey != null
      ? [
          {
            objectId: motor.controlledObjectId,
            axisKey: motor.axisKey,
            motorId: motor.id,
          },
        ]
      : [],
  );

export const getObjectBoundPlcId = (
  objectId: number,
  _objects: ControlledObject[],
  motors: Motor[],
): number | null => {
  const plcIds = new Set<number>();
  for (const motor of motors) {
    if (motor.controlledObjectId === objectId && motor.axisKey) {
      plcIds.add(motor.plcId);
    }
  }
  if (plcIds.size === 0) return null;
  return [...plcIds][0] ?? null;
};

/** 同受控物体已绑电机的从站口；无绑定时 null */
export const getObjectBoundBusNo = (
  objectId: number,
  motors: readonly Motor[],
): BusNo | null => {
  for (const motor of motors) {
    if (motor.controlledObjectId === objectId && motor.axisKey) {
      return motor.busNo;
    }
  }
  return null;
};

/** 同受控物体已绑电机的轴类型；无绑定时 null */
export const getObjectBoundAxisType = (
  objectId: number,
  motors: readonly Motor[],
): AxisTypeCode | null => {
  for (const motor of motors) {
    if (motor.controlledObjectId === objectId && motor.axisKey) {
      return getMotorAxisType(motor);
    }
  }
  return null;
};

export const canBindMotorToObject = (
  objectId: number,
  motorId: number,
  objects: ControlledObject[],
  motors: Motor[],
): boolean => {
  const motor = motors.find((item) => item.id === motorId);
  if (!motor) return false;
  const boundPlcId = getObjectBoundPlcId(objectId, objects, motors);
  if (boundPlcId != null && motor.plcId !== boundPlcId) return false;
  const boundBusNo = getObjectBoundBusNo(objectId, motors);
  if (boundBusNo !== null && motor.busNo !== boundBusNo) return false;
  // 轴类型在绑定时按物体 controlType 自动写入，不再用当前 axisType 拦截
  return true;
};

/**
 * 从 startAxisKey 起按 axes[] 顺序绑定 motorIds；多余电机忽略；不回头。
 * 约束失败时返回 { ok: false }，不返回部分结果。
 */
export const applyBindMotorsFromAxis = (
  objects: ControlledObject[],
  motors: readonly Motor[],
  objectId: number,
  startAxisKey: string,
  motorIds: readonly number[],
): { ok: true; motors: Motor[] } | { ok: false } => {
  const object = objects.find((item) => item.id === objectId);
  if (!object || motorIds.length === 0) return { ok: false };

  const startIndex = object.axes.findIndex((axis) => axis.key === startAxisKey);
  if (startIndex < 0) return { ok: false };

  const axisSlice = object.axes.slice(startIndex);
  const pairCount = Math.min(motorIds.length, axisSlice.length);
  if (pairCount === 0) return { ok: false };

  let nextMotors = motors.map((motor) => ({ ...motor }));

  for (let index = 0; index < pairCount; index += 1) {
    const motorId = motorIds[index]!;
    const axisKey = axisSlice[index]!.key;

    nextMotors = nextMotors.map((motor) => {
      if (motor.controlledObjectId === objectId && motor.axisKey === axisKey && motor.id !== motorId) {
        return unbindMotor(motor);
      }
      return motor;
    });

    if (!canBindMotorToObject(objectId, motorId, objects, nextMotors)) {
      return { ok: false };
    }

    nextMotors = nextMotors.map((motor) =>
      motor.id === motorId
        ? bindMotorToAxis(motor, objectId, axisKey, object.controlType)
        : motor,
    );
  }

  return { ok: true, motors: nextMotors };
};

export const getPlcLinkedObjectIds = (plcId: number, motors: Motor[]): number[] => {
  const ids = new Set<number>();
  for (const motor of motors) {
    if (motor.plcId === plcId && motor.controlledObjectId != null) {
      ids.add(motor.controlledObjectId);
    }
  }
  return [...ids];
};
