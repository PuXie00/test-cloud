import { mergeTemplateAxes } from "@/app/pages/console/components/right-sidebar/config-wizard/axis-utils";
import {
  CONTROL_TYPE_RULES,
  controlTypeHasNoDriveAxes,
  defaultMotionParamsForControlType,
  ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE,
  ensureMinimumDriveAxes,
  maxDriveAxesForControlType,
  resolveSwingYawModelParams,
} from "@/app/project/configuration-rules";
import type { ControlType } from "@/app/project/configuration-types";
import {
  DEFAULT_MODEL_RUN_DIRECTION,
  DEFAULT_PULLEY_DISTANCE,
} from "@/app/project/hoist-point-defaults";
import { DEFAULT_MAX_AXIS_VELOCITY } from "@/app/project/motion-speed";
import { virtualAxisMaxFieldsFor } from "@/app/project/virtual-axis-max-velocity";
import type { WizardSetupState } from "@/app/project/setup-persist";
import type {
  AxisDefinition,
  Motor,
  MountLayout,
  Plc,
} from "../components/right-sidebar/config-wizard/config-wizard-types";
import {
  toDraftMountLayout,
  validateMultiPointAxesDraft,
} from "../components/right-sidebar/config-wizard/multi-point-axes/multi-point-axes-draft";
import { createShapeFootprint } from "../components/right-sidebar/config-wizard/multi-point-axes/multi-point-axes-geometry";
import {
  bindMotorToAxis,
  canBindMotorToObject,
  isAxisBound,
  requiredAxisTypeForControlType,
  unbindMotor,
} from "./binding-utils";
import { normalizeObjectRotationDeg } from "@/app/project/object-rotation";
import { insertMotorsAtBusEnd } from "./motor-bus-order";
import {
  allocateSetupEntityIdsInProject,
  toSetupEntityIdSource,
} from "./setup-entity-id";

export type MultiPointAxesConfigurationInput = {
  axes: AxisDefinition[];
  safetyRadius: number;
  initialTiltDirection: number;
  mountRotation: number;
  mountLayout: MountLayout;
  unbindAxisKeys: readonly string[];
  bindAxisMotors: ReadonlyArray<{ axisKey: string; motorId: number }>;
};

export type ApplyMultiPointAxesConfigurationResult = {
  state: WizardSetupState;
  applied: boolean;
  reason?: string;
};

const rejectMultiPointAxesConfiguration = (
  state: WizardSetupState,
  reason: string,
): ApplyMultiPointAxesConfigurationResult => ({ state, applied: false, reason });

export const applyMultiPointAxesConfiguration = (
  state: WizardSetupState,
  objectId: number,
  input: MultiPointAxesConfigurationInput,
): ApplyMultiPointAxesConfigurationResult => {
  const object = state.objects.find((item) => item.id === objectId);
  if (!object) {
    return rejectMultiPointAxesConfiguration(state, "???????");
  }

  const footprint = createShapeFootprint(object);
  const issues = validateMultiPointAxesDraft(
    {
      safetyRadius: input.safetyRadius,
      initialTiltDirection: input.initialTiltDirection,
      mountRotation: input.mountRotation,
      mountLayout: toDraftMountLayout(input.mountLayout, input.axes.length),
      axes: input.axes,
      unbindAxisKeys: [...input.unbindAxisKeys],
      pendingBinds: {},
    },
    footprint,
    CONTROL_TYPE_RULES[object.controlType].minimumDriveAxes,
  );
  if (issues.length > 0) {
    return rejectMultiPointAxesConfiguration(state, issues[0]!.message);
  }

  const nextAxisKeys = new Set(input.axes.map((axis) => axis.key));
  const unbindAxisKeys = new Set(input.unbindAxisKeys);
  const nextObjects = state.objects.map((item) =>
    item.id !== objectId
      ? item
      : {
          ...item,
          ...(object.controlType === "multiPointSwing"
            ? {
                safetyRadius: input.safetyRadius,
                initialTiltDirection: input.initialTiltDirection,
              }
            : {}),
          mountRotation: input.mountRotation,
          mountLayout: input.mountLayout,
          axes: input.axes.map((axis) => ({
            ...axis,
            mount: { ...axis.mount },
          })),
        },
  );

  let nextMotors = state.motors.map((motor) => {
    if (motor.controlledObjectId !== objectId || motor.axisKey === null) return motor;
    if (nextAxisKeys.has(motor.axisKey) && !unbindAxisKeys.has(motor.axisKey)) return motor;
    return unbindMotor(motor);
  });

  for (const binding of input.bindAxisMotors) {
    if (!nextAxisKeys.has(binding.axisKey)) {
      return rejectMultiPointAxesConfiguration(state, `?? ${binding.axisKey} ???`);
    }
    if (!canBindMotorToObject(objectId, binding.motorId, nextObjects, nextMotors)) {
      return rejectMultiPointAxesConfiguration(
        state,
        "???????????",
      );
    }
    const target = nextMotors.find((motor) => motor.id === binding.motorId);
    if (!target?.selected) {
      return rejectMultiPointAxesConfiguration(state, "???????");
    }
    nextMotors = nextMotors.map((motor) => {
      if (motor.id === binding.motorId) {
        return bindMotorToAxis(motor, objectId, binding.axisKey, object.controlType);
      }
      if (
        motor.controlledObjectId === objectId &&
        motor.axisKey === binding.axisKey &&
        motor.id !== binding.motorId
      ) {
        return unbindMotor(motor);
      }
      return motor;
    });
  }

  return {
    applied: true,
    state: {
      ...state,
      objects: nextObjects,
      motors: nextMotors,
    },
  };
};

export const removeMotorCascade = (
  state: WizardSetupState,
  motorId: number,
): WizardSetupState => ({
  ...state,
  motors: state.motors.filter((motor) => motor.id !== motorId),
  objects: state.objects,
  plcs: state.plcs,
});

export const removeMotorsCascade = (
  state: WizardSetupState,
  motorIds: readonly number[],
): WizardSetupState =>
  motorIds.reduce((current, motorId) => removeMotorCascade(current, motorId), state);

export const removeControlledObject = (
  state: WizardSetupState,
  objectId: number,
): WizardSetupState => {
  // ?????????????
  const motors = state.motors.map((motor) =>
    motor.controlledObjectId === objectId ? unbindMotor(motor) : motor,
  );

  return {
    ...state,
    motors,
    objects: state.objects.filter((object) => object.id !== objectId),
  };
};

export const removePlcCascade = (
  state: WizardSetupState,
  plcId: number,
): WizardSetupState => {
  // ??????????????????????
  const unboundMotors = state.motors.map((motor) =>
    motor.plcId === plcId && motor.controlledObjectId != null
      ? unbindMotor(motor)
      : motor,
  );

  return {
    ...state,
    plcs: state.plcs.filter((plc) => plc.id !== plcId),
    motors: unboundMotors.filter((motor) => motor.plcId !== plcId),
    objects: state.objects,
  };
};

export const createPlcWithMotorSlots = (
  state: WizardSetupState,
  input: {
    plc: Plc;
    motors: Motor[];
  },
): WizardSetupState => ({
  ...state,
  plcs: [...state.plcs, input.plc],
  motors: [...state.motors, ...input.motors],
});

export type InsertMotorsPosition = "before" | "after";

export type InsertMotorsRelativeResult = {
  state: WizardSetupState;
  inserted: Motor[];
};

/** ??????????????? */
export const insertMotorsRelative = (
  state: WizardSetupState,
  input: {
    anchorMotorId: number;
    position: InsertMotorsPosition;
    count: number;
    /** ????????? */
    productModel?: string;
    /** ?????????? */
    busNo?: Motor["busNo"];
    /** ?????????0? */
    axisType?: Motor["axisType"];
    createParams: (productModel: string) => Motor["params"];
  },
): InsertMotorsRelativeResult => {
  const anchorIndex = state.motors.findIndex((motor) => motor.id === input.anchorMotorId);
  if (anchorIndex < 0) return { state, inserted: [] };

  const anchor = state.motors[anchorIndex]!;
  const count = Math.max(1, Math.floor(input.count));
  const insertAt = input.position === "before" ? anchorIndex : anchorIndex + 1;
  const ids = allocateSetupEntityIdsInProject(toSetupEntityIdSource(state), count);
  const busNo = input.busNo ?? anchor.busNo;
  const axisType = input.axisType === 1 ? 1 : 0;

  const inserted: Motor[] = Array.from({ length: count }, (_, index) => {
    const productModel = input.productModel ?? anchor.productModel;
    return {
      id: ids[index]!,
      productModel,
      plcId: anchor.plcId,
      busNo,
      axisType,
      nodeAddress: null,
      discoveryId: null,
      selected: true,
      controlledObjectId: null,
      axisKey: null,
      params: input.createParams(productModel),
    };
  });

  // ????????????????????????? C-D-C
  const motors =
    busNo === anchor.busNo
      ? [...state.motors.slice(0, insertAt), ...inserted, ...state.motors.slice(insertAt)]
      : insertMotorsAtBusEnd(state.motors, anchor.plcId, busNo, inserted);

  return {
    state: { ...state, motors },
    inserted,
  };
};

export const changeObjectControlType = (
  state: WizardSetupState,
  objectId: number,
  controlType: ControlType,
): WizardSetupState => {
  const resolved = controlType;
  const object = state.objects.find((item) => item.id === objectId);
  if (!object) return state;

  if (controlTypeHasNoDriveAxes(resolved)) {
    return {
      ...state,
      objects: state.objects.map((item) => {
        if (item.id !== objectId) return item;
        const {
          safetyRadius: _dropSafetyRadius,
          initialTiltDirection: _dropInitialTilt,
          mountRotation: _dropMountRotation,
          mountLayout: _dropMountLayout,
          pMaxVelocity: _dropPMaxVelocity,
          yMaxVelocity: _dropYMaxVelocity,
          ...rest
        } = item;
        return {
          ...rest,
          controlType: resolved,
          rotation: normalizeObjectRotationDeg(item.rotation, resolved),
          axes: [],
          motionParams: defaultMotionParamsForControlType(resolved),
          ...resolveSwingYawModelParams(resolved),
          ...virtualAxisMaxFieldsFor(ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[resolved], item),
        };
      }),
      motors: state.motors.map((motor) =>
        motor.controlledObjectId === objectId ? unbindMotor(motor) : motor,
      ),
    };
  }

  const motionParams = defaultMotionParamsForControlType(resolved);
  const requiredAxisType = requiredAxisTypeForControlType(resolved);
  for (const axis of CONTROL_TYPE_RULES[resolved].motionAxes) {
    if (object.motionParams?.[axis]) {
      motionParams[axis] = object.motionParams[axis];
    }
  }

  const templateKeys = ensureMinimumDriveAxes(resolved, []).map((axis) => ({ key: axis.key }));
  const mergedAxes = mergeTemplateAxes(resolved, templateKeys, object.axes);
  const maxDriveAxes = maxDriveAxesForControlType(resolved);
  const nextAxes = maxDriveAxes !== undefined ? mergedAxes.slice(0, maxDriveAxes) : mergedAxes;
  const nextKeys = new Set(nextAxes.map((axis) => axis.key));

  return {
    ...state,
    objects: state.objects.map((item) => {
      if (item.id !== objectId) return item;
      const {
        safetyRadius: _dropSafetyRadius,
        initialTiltDirection: _dropInitialTilt,
        mountRotation: _dropMountRotation,
        mountLayout: _dropMountLayout,
        pMaxVelocity: _dropPMaxVelocity,
        yMaxVelocity: _dropYMaxVelocity,
        ...rest
      } = item;

      return {
        ...rest,
        controlType: resolved,
        rotation: normalizeObjectRotationDeg(item.rotation, resolved),
        motionParams,
        axes: nextAxes,
        pulleyDistance: item.pulleyDistance ?? DEFAULT_PULLEY_DISTANCE,
        modelRunDirection: item.modelRunDirection ?? DEFAULT_MODEL_RUN_DIRECTION,
        maxAxisVelocity: item.maxAxisVelocity ?? DEFAULT_MAX_AXIS_VELOCITY,
        ...resolveSwingYawModelParams(resolved, item),
        ...virtualAxisMaxFieldsFor(ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[resolved], item),
      };
    }),
    motors: state.motors.map((motor) => {
      if (motor.controlledObjectId !== objectId) return motor;
      if (motor.axisKey && nextKeys.has(motor.axisKey)) {
        return { ...motor, axisType: requiredAxisType };
      }
      return unbindMotor(motor);
    }),
  };
};

export const removeObjectAxisCascade = (
  state: WizardSetupState,
  objectId: number,
  axisKey: string,
): { state: WizardSetupState; removed: boolean } => {
  const object = state.objects.find((item) => item.id === objectId);
  if (!object) return { state, removed: false };

  const axis = object.axes.find((item) => item.key === axisKey);
  if (!axis) return { state, removed: false };

  const minimum = CONTROL_TYPE_RULES[object.controlType].minimumDriveAxes;
  if (object.axes.length <= minimum) return { state, removed: false };

  return {
    removed: true,
    state: {
      ...state,
      objects: state.objects.map((item) =>
        item.id !== objectId
          ? item
          : { ...item, axes: item.axes.filter((entry) => entry.key !== axisKey) },
      ),
      motors: state.motors.map((motor) =>
        motor.controlledObjectId === objectId && motor.axisKey === axisKey
          ? unbindMotor(motor)
          : motor,
      ),
    },
  };
};

export const removeObjectAxisSafely = (
  state: WizardSetupState,
  objectId: number,
  axisKey: string,
): { state: WizardSetupState; removed: boolean } => {
  const object = state.objects.find((item) => item.id === objectId);
  if (!object) return { state, removed: false };

  const axis = object.axes.find((item) => item.key === axisKey);
  if (!axis || isAxisBound(objectId, axisKey, state.motors)) return { state, removed: false };

  return removeObjectAxisCascade(state, objectId, axisKey);
};
