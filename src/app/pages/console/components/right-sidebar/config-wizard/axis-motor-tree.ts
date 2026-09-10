import type { BusNo, Motor, Plc } from "./config-wizard-types";
import {
  getMotorAxisType,
  type AxisBindingRef,
} from "@/app/pages/console/hooks/binding-utils";
import { busNoLabel } from "@/app/pages/console/hooks/motor-bus";
import type { AxisTypeCode } from "../property-forms/motor-drive-params";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";

export type MotorBindDisabledReason =
  | "taken"
  | "plc"
  | "bus"
  | "axisType"
  | "unselected";

export const MOTOR_BIND_DISABLED_LABELS: Record<MotorBindDisabledReason, string> = {
  taken: "已绑定其他轴",
  plc: "不同主控",
  bus: "不同从站口",
  axisType: "不同轴类型",
  unselected: "未启用",
};

export type AxisMotorTreeMotorNode = {
  kind: "motor";
  motor: Motor;
  label: string;
  selected: boolean;
  disabled: boolean;
  disabledReason: MotorBindDisabledReason | null;
};

export type AxisMotorTreeBusNode = {
  kind: "bus";
  busNo: BusNo;
  label: string;
  motors: AxisMotorTreeMotorNode[];
};

export type AxisMotorTreePlcNode = {
  kind: "plc";
  plc: Plc;
  label: string;
  incompatible: boolean;
  buses: AxisMotorTreeBusNode[];
};

export type AxisMotorTree = AxisMotorTreePlcNode[];

export type AxisBindingConstraints = {
  plcId: number | null;
  busNo: BusNo | null;
  axisType: AxisTypeCode | null;
};

export const getBindingConstraintsForAxis = (
  objectId: number,
  axisKey: string,
  value: number | null,
  motors: readonly Motor[],
  effectiveBindings: readonly AxisBindingRef[],
): AxisBindingConstraints => {
  const motorById = new Map(motors.map((motor) => [motor.id, motor]));
  const otherBindings = effectiveBindings.filter(
    (binding) => binding.objectId === objectId && binding.axisKey !== axisKey,
  );
  const constraintMotorIds =
    otherBindings.length > 0
      ? otherBindings.map((binding) => binding.motorId)
      : value
        ? [value]
        : [];

  let plcId: number | null = null;
  let busNo: BusNo | null = null;
  let axisType: AxisTypeCode | null = null;

  for (const motorId of constraintMotorIds) {
    const motor = motorById.get(motorId);
    if (!motor) continue;
    plcId ??= motor.plcId;
    busNo ??= motor.busNo;
    axisType ??= getMotorAxisType(motor);
  }

  return { plcId, busNo, axisType };
};

export const getMotorBindDisabledReason = (
  motor: Motor,
  options: {
    objectId: number;
    axisKey: string;
    value: number | null;
    constraints: AxisBindingConstraints;
    effectiveBindings: readonly AxisBindingRef[];
  },
): MotorBindDisabledReason | null => {
  if (!motor.selected) return "unselected";

  const takenByOther = options.effectiveBindings.some(
    (binding) =>
      binding.motorId === motor.id &&
      !(binding.objectId === options.objectId && binding.axisKey === options.axisKey),
  );
  if (takenByOther) return "taken";

  if (options.constraints.plcId && motor.plcId !== options.constraints.plcId) {
    return "plc";
  }
  if (
    options.constraints.busNo !== null &&
    motor.busNo !== options.constraints.busNo
  ) {
    return "bus";
  }
  if (
    options.constraints.axisType !== null &&
    getMotorAxisType(motor) !== options.constraints.axisType
  ) {
    return "axisType";
  }

  return null;
};

const BUS_ORDER: readonly BusNo[] = [0, 1];

const toMotorNode = (
  motor: Motor,
  options: {
    objectId: number;
    axisKey: string;
    value: number | null;
    motors: readonly Motor[];
    constraints: AxisBindingConstraints;
    effectiveBindings: readonly AxisBindingRef[];
  },
): AxisMotorTreeMotorNode => {
  const disabledReason = getMotorBindDisabledReason(motor, {
    objectId: options.objectId,
    axisKey: options.axisKey,
    value: options.value,
    constraints: options.constraints,
    effectiveBindings: options.effectiveBindings,
  });
  return {
    kind: "motor",
    motor,
    label: formatMotorDisplayName(options.motors, motor),
    selected: motor.id === options.value,
    disabled: disabledReason !== null,
    disabledReason,
  };
};

export const buildAxisMotorTree = (options: {
  objectId: number;
  axisKey: string;
  value: number | null;
  plcs: readonly Plc[];
  motors: readonly Motor[];
  effectiveBindings: readonly AxisBindingRef[];
}): AxisMotorTree => {
  const constraints = getBindingConstraintsForAxis(
    options.objectId,
    options.axisKey,
    options.value,
    options.motors,
    options.effectiveBindings,
  );

  return options.plcs.map((plc) => {
    const plcMotors = options.motors.filter((motor) => motor.plcId === plc.id);
    const buses: AxisMotorTreeBusNode[] = BUS_ORDER.flatMap((busNo) => {
      const busMotors = plcMotors
        .filter((motor) => motor.busNo === busNo)
        .map((motor) => toMotorNode(motor, { ...options, constraints }));
      if (busMotors.length === 0) return [];
      return [
        {
          kind: "bus" as const,
          busNo,
          label: busNoLabel(busNo),
          motors: busMotors,
        },
      ];
    });

    const allMotors = buses.flatMap((bus) => bus.motors);
    return {
      kind: "plc" as const,
      plc,
      label: formatPlcDisplayName(options.plcs, plc),
      incompatible: allMotors.length > 0 && allMotors.every((node) => node.disabled),
      buses,
    };
  });
};

export const getDefaultExpandedPlcIds = (
  tree: AxisMotorTree,
  value: number | null,
): number[] => {
  if (value) {
    const owner = tree.find((node) =>
      node.buses.some((bus) => bus.motors.some((motor) => motor.motor.id === value)),
    );
    if (owner) return [owner.plc.id];
  }
  return tree.map((node) => node.plc.id);
};
