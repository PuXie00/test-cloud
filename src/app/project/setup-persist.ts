import type {
  ControlledObject,
  Motor,
  Plc,
} from "@/app/pages/console/components/right-sidebar/config-wizard/config-wizard-types";
import { getDefaultPlcRegistryEntry } from "@/app/pages/console/hooks/motor-config";
import {
  defaultMotionParamsForControlType,
  ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE,
  ensureMinimumDriveAxes,
  resolveSwingYawModelParams,
} from "./configuration-rules";
import {
  DEFAULT_MODEL_RUN_DIRECTION,
  DEFAULT_PULLEY_DISTANCE,
  normalizeModelRunDirection,
  normalizeSafetyRadius,
} from "./hoist-point-defaults";
import { encodeControlType } from "./control-type-code";
import { normalizeMaxAxisVelocity } from "./motion-speed";
import { virtualAxisMaxFieldsFor } from "./virtual-axis-max-velocity";
import { normalizeMotionParams } from "./motion-acceleration";
import type {
  ControlType,
  ControlledObjectConfig,
  MotionAxisKind,
  MotionAxisParams,
  MotorConfig,
  MountLayout,
  PlcConfig,
  ProjectSetup,
  ShapeDimensions,
  ShapePresetId,
  VirtualAxisId,
} from "./project-document-types";
import { normalizeObjectRotationDeg } from "./object-rotation";
import {
  roundProjectCoordinate,
  roundProjectMount,
  roundProjectVec3,
} from "./project-quantity";

const assertControlType = (controlType: string): ControlType => {
  if (!(controlType in ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE)) {
    throw new Error(`Unknown control type "${controlType}"`);
  }
  return controlType as ControlType;
};

export type WizardSetupState = {
  objects: ControlledObject[];
  plcs: Plc[];
  motors: Motor[];
};

const deriveShapeDimensions = (
  shapePreset: ShapePresetId,
  dimensions: { w: number; h: number; d: number },
): ShapeDimensions => {
  const { w, h, d } = dimensions;
  switch (shapePreset) {
    case "cube":
      return { width: w, height: h, depth: d };
    case "cyl":
      return { diameter: Math.max(w, d), height: h };
    case "sphere":
      return { diameter: Math.max(w, h, d) };
    case "ring": {
      const outerDiameter = Math.max(w, d);
      return { outerDiameter, innerDiameter: outerDiameter * 0.6, thickness: h };
    }
    case "sqRing":
      return {
        outerWidth: w,
        outerDepth: d,
        ringWidth: Math.min(w, d) * 0.2,
        thickness: h,
      };
    case "prism6":
      return { acrossFlats: Math.max(w, d), height: h };
    case "external":
      return { width: w, height: h, depth: d };
  }
};

const resolveShapeDimensions = (object: ControlledObject): ShapeDimensions =>
  object.shapeDimensions ?? deriveShapeDimensions(object.shapePreset, object.dimensions);

const resolveMotionParams = (
  object: ControlledObject,
  controlType: ControlType,
): Partial<Record<MotionAxisKind, MotionAxisParams>> => {
  const raw =
    Object.keys(object.motionParams ?? {}).length > 0
      ? (object.motionParams ?? {})
      : defaultMotionParamsForControlType(controlType);
  return normalizeMotionParams(raw);
};

const persistMountLayout = (layout: MountLayout | undefined): MountLayout | undefined => {
  if (!layout) return undefined;
  if (layout.kind === "custom") return { kind: "custom" };
  if (layout.kind === "line") {
    return {
      kind: "line",
      spacings: layout.spacings.map(roundProjectCoordinate),
    };
  }
  return {
    kind: "circle",
    radius: roundProjectCoordinate(layout.radius),
    chordLengths: layout.chordLengths.map(roundProjectCoordinate),
  };
};

export const wizardControlledObjectToConfig = (object: ControlledObject): ControlledObjectConfig => {
  const controlType = assertControlType(object.controlType);
  const swingYaw = resolveSwingYawModelParams(controlType, object);
  const mountLayout = persistMountLayout(object.mountLayout);

  return {
    id: object.id,
    name: object.name,
    controlType: encodeControlType(controlType),
    enabledVirtualAxes: [...ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[controlType]] as VirtualAxisId[],
    shapePreset: object.shapePreset,
    shapeDimensions: resolveShapeDimensions(object),
    dimensions: object.dimensions,
    position: roundProjectVec3(object.position),
    centerOffset: roundProjectVec3(object.centerOffset),
    rotation: roundProjectVec3(normalizeObjectRotationDeg(object.rotation, controlType)),
    color: object.color,
    pulleyDistance:
      typeof object.pulleyDistance === "number" &&
      Number.isFinite(object.pulleyDistance) &&
      object.pulleyDistance >= 0
        ? roundProjectCoordinate(object.pulleyDistance)
        : DEFAULT_PULLEY_DISTANCE,
    modelRunDirection: normalizeModelRunDirection(
      object.modelRunDirection ?? DEFAULT_MODEL_RUN_DIRECTION,
    ),
    maxAxisVelocity: normalizeMaxAxisVelocity(object.maxAxisVelocity),
    ...virtualAxisMaxFieldsFor(ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[controlType], object),
    ...(swingYaw.safetyRadius !== undefined
      ? {
          safetyRadius: roundProjectCoordinate(normalizeSafetyRadius(swingYaw.safetyRadius)),
          initialTiltDirection: swingYaw.initialTiltDirection,
          mountRotation: swingYaw.mountRotation,
        }
      : {}),
    ...(mountLayout !== undefined ? { mountLayout } : {}),
    driveAxes: ensureMinimumDriveAxes(
      controlType,
      object.axes.map((axis) => ({
        key: axis.key,
        ...(axis.custom ? { custom: true } : {}),
        mount: roundProjectMount(axis.mount),
      })),
    ),
    motionParams: resolveMotionParams(object, controlType),
    ...(object.motionSpeedControl !== undefined
      ? { motionSpeedControl: object.motionSpeedControl }
      : {}),
    ...(object.modelId !== undefined ? { modelId: object.modelId } : {}),
    params: { ...object.params },
  };
};

export const wizardPlcToConfig = (plc: Plc, existing?: PlcConfig): PlcConfig => ({
  id: plc.id,
  masterTypeId:
    plc.masterTypeId || existing?.masterTypeId || getDefaultPlcRegistryEntry().productModel,
  ip: plc.ip,
});

export const wizardMotorToConfig = (motor: Motor): MotorConfig => ({
  id: motor.id,
  productModel: motor.productModel,
  plcId: motor.plcId,
  busNo: motor.busNo,
  axisType: motor.axisType,
  nodeAddress: motor.nodeAddress,
  discoveryId: motor.discoveryId ?? null,
  controlledObjectId: motor.controlledObjectId,
  axisKey: motor.axisKey,
  params: { ...motor.params },
});

export const persistSetupFromWizard = (
  state: WizardSetupState,
  existing?: ProjectSetup,
): ProjectSetup => {
  const existingPlcsById = new Map(existing?.plcs.map((plc) => [plc.id, plc]) ?? []);
  const objectIds = new Set(state.objects.map((object) => object.id));

  const alignment = Object.fromEntries(
    Object.entries(existing?.alignment ?? {}).filter(([objectId]) =>
      objectIds.has(Number(objectId)),
    ),
  );

  return {
    plcs: state.plcs.map((plc) => wizardPlcToConfig(plc, existingPlcsById.get(plc.id))),
    motors: state.motors.map(wizardMotorToConfig),
    controlledObjects: state.objects.map(wizardControlledObjectToConfig),
    alignment,
    ...(existing?.scene !== undefined ? { scene: existing.scene } : {}),
    ...(existing?.manualJog !== undefined ? { manualJog: existing.manualJog } : {}),
  };
};
