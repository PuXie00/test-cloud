import type { ControlType, MotionAxisParams } from "@/app/project/configuration-types";
import type {
  ControlledObject,
  Motor,
} from "../components/right-sidebar/config-wizard/config-wizard-types";
import { isCppAckFailed } from "@shared/csocket/ack";
import { runCsocket } from "./motor-csocket-payload";

export type ModelTypeCode = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

const MODEL_TYPE_BY_CONTROL_TYPE: Record<
  Exclude<ControlType, "staticProp">,
  ModelTypeCode
> = {
  singlePointMove: 2,
  singlePointRotation: 10,
  multiLevelHoist: 3,
  continuousRotation: 4,
  railCar: 5,
  twoPointSwing: 6,
  multiPointSwing: 7,
  dualTiltFourPointSwing: 8,
  fourPointSwing: 9,
};

export const encodeModelType = (controlType: ControlType): ModelTypeCode | null =>
  controlType === "staticProp" ? null : MODEL_TYPE_BY_CONTROL_TYPE[controlType];

type MappedAxis = {
  maxStroke: number;
  minStroke: number;
  defaultVelocity: number;
  defaultAcceleration: number;
  defaultDeceleration: number;
  maxAcceleration: number;
  maxDeceleration: number;
  abnormalDeceleration: number;
};

const ZERO_AXIS: MappedAxis = {
  maxStroke: 0,
  minStroke: 0,
  defaultVelocity: 0,
  defaultAcceleration: 0,
  defaultDeceleration: 0,
  maxAcceleration: 0,
  maxDeceleration: 0,
  abnormalDeceleration: 0,
};

const mapAxis = (params?: MotionAxisParams): MappedAxis =>
  params
    ? {
        maxStroke: params.maxAngle,
        minStroke: params.minAngle,
        defaultVelocity: params.speed,
        defaultAcceleration: params.acceleration,
        defaultDeceleration: params.deceleration,
        maxAcceleration: params.maxAcceleration,
        maxDeceleration: params.maxDeceleration,
        abnormalDeceleration: params.abnormalDeceleration,
      }
    : ZERO_AXIS;

export type ModelIdentityPayload = {
  deviceId: number;
  deviceType: ModelTypeCode;
};

export type ModelBindingParamCount = {
  hangingPointCount: number;
  hangingPointArray: number[][];
  axisIdList: number[];
};

export type ModelParamCount = ModelBindingParamCount & {
  modelType: ModelTypeCode;
  modelRunDirection: ControlledObject["modelRunDirection"];
  pulleyDistance: number;
  safetyRadius?: number;
  initialTiltDirection?: number;
  hMaxStroke: number;
  hMinStroke: number;
  hDefaultVelocity: number;
  hDefaultAcceleration: number;
  hDefaultDeceleration: number;
  hMaxAcceleration: number;
  hMaxDeceleration: number;
  hAbnormalDeceleration: number;
  pMaxStroke?: number;
  pMinStroke?: number;
  pDefaultVelocity?: number;
  pDefaultAcceleration?: number;
  pDefaultDeceleration?: number;
  pMaxAcceleration?: number;
  pMaxDeceleration?: number;
  pAbnormalDeceleration?: number;
  pMaxVelocity?: number;
  yMaxStroke?: number;
  yMinStroke?: number;
  yDefaultVelocity?: number;
  yDefaultAcceleration?: number;
  yDefaultDeceleration?: number;
  yMaxAcceleration?: number;
  yMaxDeceleration?: number;
  yAbnormalDeceleration?: number;
  yMaxVelocity?: number;
};

export type ModelConfigurePayload = {
  deviceId: number;
  paramCount: ModelParamCount;
};

export type ModelAddPayload = ModelConfigurePayload & {
  deviceType: ModelTypeCode;
};

export const buildModelDeletePayload = (
  object: ControlledObject,
): ModelIdentityPayload | null => {
  const deviceType = encodeModelType(object.controlType);
  if (deviceType === null) return null;
  return { deviceId: object.id, deviceType };
};

const buildHangingBinding = (
  object: ControlledObject,
  motors: readonly Motor[],
): ModelBindingParamCount => ({
  hangingPointCount: object.axes.length,
  hangingPointArray: object.axes.map((axis) => [axis.mount.x, axis.mount.z]),
  axisIdList: object.axes.map(
    (axis) =>
      motors.find(
        (motor) =>
          motor.controlledObjectId === object.id && motor.axisKey === axis.key,
      )?.id ?? 0,
  ),
});

const resolveHKind = (controlType: ControlType): "rotation" | "move" =>
  controlType === "singlePointRotation" || controlType === "continuousRotation"
    ? "rotation"
    : "move";

const resolveYParams = (object: ControlledObject): MotionAxisParams | undefined => {
  if (object.controlType === "fourPointSwing" || object.controlType === "dualTiltFourPointSwing") {
    return object.motionParams?.swingY;
  }
  if (object.controlType === "multiPointSwing") {
    return object.motionParams?.yawY;
  }
  return undefined;
};

const prefixedAxisFields = (prefix: "p" | "y", axis: MappedAxis) =>
  prefix === "p"
    ? {
        pMaxStroke: axis.maxStroke,
        pMinStroke: axis.minStroke,
        pDefaultVelocity: axis.defaultVelocity,
        pDefaultAcceleration: axis.defaultAcceleration,
        pDefaultDeceleration: axis.defaultDeceleration,
        pMaxAcceleration: axis.maxAcceleration,
        pMaxDeceleration: axis.maxDeceleration,
        pAbnormalDeceleration: axis.abnormalDeceleration,
      }
    : {
        yMaxStroke: axis.maxStroke,
        yMinStroke: axis.minStroke,
        yDefaultVelocity: axis.defaultVelocity,
        yDefaultAcceleration: axis.defaultAcceleration,
        yDefaultDeceleration: axis.defaultDeceleration,
        yMaxAcceleration: axis.maxAcceleration,
        yMaxDeceleration: axis.maxDeceleration,
        yAbnormalDeceleration: axis.abnormalDeceleration,
      };

export const buildModelParamPayload = (
  object: ControlledObject,
  motors: readonly Motor[],
): ModelConfigurePayload | null => {
  const modelType = encodeModelType(object.controlType);
  if (modelType === null) return null;

  const hanging = buildHangingBinding(object, motors);

  const h = mapAxis(object.motionParams?.[resolveHKind(object.controlType)]);
  const pRaw = object.motionParams?.swingX;
  const yRaw = resolveYParams(object);
  const p = pRaw ? mapAxis(pRaw) : undefined;
  const y = yRaw ? mapAxis(yRaw) : undefined;

  return {
    deviceId: object.id,
    paramCount: {
      modelType,
      modelRunDirection: object.modelRunDirection,
      pulleyDistance: object.pulleyDistance,
      ...(object.safetyRadius !== undefined ? { safetyRadius: object.safetyRadius } : {}),
      ...(object.initialTiltDirection !== undefined
        ? { initialTiltDirection: object.initialTiltDirection }
        : {}),
      ...hanging,
      hMaxStroke: h.maxStroke,
      hMinStroke: h.minStroke,
      hDefaultVelocity: h.defaultVelocity,
      hDefaultAcceleration: h.defaultAcceleration,
      hDefaultDeceleration: h.defaultDeceleration,
      hMaxAcceleration: h.maxAcceleration,
      hMaxDeceleration: h.maxDeceleration,
      hAbnormalDeceleration: h.abnormalDeceleration,
      ...(p ? prefixedAxisFields("p", p) : {}),
      ...(p && object.pMaxVelocity !== undefined ? { pMaxVelocity: object.pMaxVelocity } : {}),
      ...(y ? prefixedAxisFields("y", y) : {}),
      ...(y && object.yMaxVelocity !== undefined ? { yMaxVelocity: object.yMaxVelocity } : {}),
    },
  };
};

export const buildModelAddPayload = (
  object: ControlledObject,
  motors: readonly Motor[],
): ModelAddPayload | null => {
  const payload = buildModelParamPayload(object, motors);
  if (!payload) return null;
  return { ...payload, deviceType: payload.paramCount.modelType };
};

export type ModelSyncState = {
  objects: readonly ControlledObject[];
  motors: readonly Motor[];
};

export type ModelSyncMode =
  | "explicit"
  | "tracked-preview"
  | "tracked-commit"
  | "history";

type ModelTypeChangePayload = {
  deviceId: number;
  oldDeviceType: ModelTypeCode;
  deviceType: ModelTypeCode;
  paramCount: ModelParamCount;
};

const modelParamKey = (object: ControlledObject, motors: readonly Motor[]): string => {
  const paramCount = buildModelParamPayload(object, motors)?.paramCount;
  if (!paramCount) return "null";
  return JSON.stringify({
    ...paramCount,
    axisKeys: object.axes.map((axis) => axis.key),
    dimensions: object.dimensions,
    shapeDimensions: object.shapeDimensions,
  });
};

const isPlcModel = (object: ControlledObject | undefined): object is ControlledObject =>
  object !== undefined && encodeModelType(object.controlType) !== null;

export const syncModelsByDiff = (
  prev: ModelSyncState,
  next: ModelSyncState,
  mode: ModelSyncMode = "explicit",
): void => {
  const prevById = new Map(prev.objects.map((object) => [object.id, object]));
  const nextById = new Map(next.objects.map((object) => [object.id, object]));
  const ids = new Set([...prevById.keys(), ...nextById.keys()]);

  const removed: ModelIdentityPayload[] = [];
  const typeChanged: ModelTypeChangePayload[] = [];
  const added: ModelAddPayload[] = [];
  const paramsChanged: ModelConfigurePayload[] = [];

  for (const id of ids) {
    const prevObject = prevById.get(id);
    const nextObject = nextById.get(id);
    const prevPlc = isPlcModel(prevObject);
    const nextPlc = isPlcModel(nextObject);

    if (prevPlc && !nextPlc) {
      const payload = buildModelDeletePayload(prevObject);
      if (payload) removed.push(payload);
      continue;
    }

    if (!prevPlc && nextPlc) {
      const payload = buildModelAddPayload(nextObject, next.motors);
      if (payload) added.push(payload);
      continue;
    }

    if (!prevPlc || !nextPlc) continue;

    const prevModelType = encodeModelType(prevObject.controlType);
    const nextModelType = encodeModelType(nextObject.controlType);
    const nextParamCount = buildModelParamPayload(nextObject, next.motors)?.paramCount;
    if (prevModelType !== nextModelType && nextParamCount) {
      if (nextModelType !== null && prevModelType !== null) {
        typeChanged.push({
          deviceId: nextObject.id,
          oldDeviceType: prevModelType as ModelTypeCode,
          deviceType: nextModelType as ModelTypeCode,
          paramCount: nextParamCount,
        });
      }
      continue;
    }

    if (modelParamKey(prevObject, prev.motors) !== modelParamKey(nextObject, next.motors)) {
      const payload = buildModelParamPayload(nextObject, next.motors);
      if (payload) paramsChanged.push(payload);
    }
  }

  const emitLifecycle = mode !== "tracked-commit";
  const emitParams = mode !== "tracked-preview";

  const removedBatch = emitLifecycle ? removed : [];
  const typeBatch = emitLifecycle ? typeChanged : [];
  const addedBatch = emitLifecycle ? added : [];
  const paramBatch = emitParams ? paramsChanged : [];

  if (
    removedBatch.length === 0 &&
    typeBatch.length === 0 &&
    addedBatch.length === 0 &&
    paramBatch.length === 0
  ) {
    return;
  }

  runCsocket("syncModelsByDiff", async () => {
    if (removedBatch.length > 0) {
      const result = await window.csocketApi.deleteModelPlc(removedBatch);
      if (isCppAckFailed(result)) return result;
    }
    if (typeBatch.length > 0) {
      console.log('typeBatch', typeBatch)
      const result = await window.csocketApi.modifyModelType(typeBatch);
      if (isCppAckFailed(result)) return result;
    }
    if (addedBatch.length > 0) {
      const result = await window.csocketApi.addModelWithDefaultValues(addedBatch);
      if (isCppAckFailed(result)) return result;
    }
    if (paramBatch.length > 0) {
      const result = await window.csocketApi.configureModelParamModel(paramBatch);
      if (isCppAckFailed(result)) return result;
    }
    return { success: true };
  });
};
