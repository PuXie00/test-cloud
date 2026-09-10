import type { ControlType, MotionAxisParams } from "@/app/project/configuration-types";
import type {
  ControlledObject,
  Motor,
} from "../components/right-sidebar/config-wizard/config-wizard-types";
import { encodeSolverType, type SolverTypeCode } from "./couple-kinematics-type";

export type SolverCallItem = {
  index: number;
  type: SolverTypeCode;
  origin_distance1: number;
  origin_distance2: number;
  params: number[][];
  motor_H: number[];
  limit_data: number[][];
  limit_rim: number[];
  betainit: number;
  HPY: [number, number, number];
};

export type SolverIndexEntry<T> = {
  objectId: number;
  payload: T;
  index: number;
};

const ZERO_LIMIT = [0, 0] as const;

const axisLimit = (params?: MotionAxisParams): number[] =>
  params ? [params.minAngle, params.maxAngle] : [...ZERO_LIMIT];

const motorsForObject = (object: ControlledObject, motors: readonly Motor[]): Motor[] =>
  object.axes.map(
    (axis) =>
      motors.find(
        (motor) => motor.controlledObjectId === object.id && motor.axisKey === axis.key,
      ) ?? {
        id: 0,
        productModel: "",
        plcId: 0,
        busNo: 0 as const,
        axisType: 0 as const,
        nodeAddress: null,
        selected: false,
        controlledObjectId: object.id,
        axisKey: axis.key,
        params: {},
      },
  );

const mountDistance = (object: ControlledObject): number => {
  const [a, b] = object.axes;
  if (!a || !b) return 0;
  const dx = a.mount.x - b.mount.x;
  const dz = a.mount.z - b.mount.z;
  return Math.hypot(dx, dz);
};

const mountBBoxSpan = (object: ControlledObject): [number, number] => {
  const xs = object.axes.map((axis) => axis.mount.x);
  const zs = object.axes.map((axis) => axis.mount.z);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)];
};

const originDistances = (object: ControlledObject): { origin_distance1: number; origin_distance2: number } =>
  object.modelRunDirection === 2
    ? { origin_distance1: 0, origin_distance2: object.pulleyDistance }
    : { origin_distance1: object.pulleyDistance, origin_distance2: 0 };

const yParams = (object: ControlledObject): MotionAxisParams | undefined => {
  if (object.controlType === "fourPointSwing" || object.controlType === "dualTiltFourPointSwing") {
    return object.motionParams?.swingY;
  }
  if (object.controlType === "multiPointSwing") {
    return object.motionParams?.yawY;
  }
  return undefined;
};

const paramsForType = (object: ControlledObject, type: SolverTypeCode): number[][] => {
  if (type === 32) return [[mountDistance(object)]];
  if (type === 64) return [mountBBoxSpan(object)];
  return object.axes.map((axis) => [axis.mount.x, axis.mount.z, 0]);
};

const rimForType = (object: ControlledObject, type: SolverTypeCode): number[] => {
  if (type === 32) return [object.dimensions.w];
  if (type === 64) return [object.dimensions.w, object.dimensions.d];
  return [object.safetyRadius ?? 0];
};

export const assignSolverIndexes = <T>(
  entries: ReadonlyArray<{ objectId: number; payload: T }>,
): SolverIndexEntry<T>[] =>
  entries.map((entry, offset) => ({ ...entry, index: offset + 1 }));

export const buildSolverCallItem = (input: {
  object: ControlledObject;
  motors: readonly Motor[];
  motorPositions: ReadonlyMap<number, number>;
  hpy: readonly [number, number, number];
  index: number;
}): SolverCallItem => {
  const type = encodeSolverType(input.object.controlType);
  if (type === null) {
    throw new Error(`controlType ${input.object.controlType} does not use the solver exe`);
  }
  const bound = motorsForObject(input.object, input.motors);
  const origins = originDistances(input.object);
  return {
    index: input.index,
    type,
    ...origins,
    params: paramsForType(input.object, type),
    motor_H: bound.map((motor) => input.motorPositions.get(motor.id) ?? 0),
    // motor_H: bound.map((motor) => 0),
    limit_data: [
      axisLimit(input.object.motionParams?.move),
      axisLimit(input.object.motionParams?.swingX),
      axisLimit(yParams(input.object)),
    ],
    limit_rim: rimForType(input.object, type),
    betainit: type === 63 ? (input.object.initialTiltDirection ?? 0) : 0,
    HPY: [input.hpy[0], input.hpy[1], input.hpy[2]],
    // HPY: [0, 0, 0],
  };
};

export const needsSolverExe = (controlType: ControlType): boolean =>
  encodeSolverType(controlType) !== null;

export const objectMotorsInAxisOrder = motorsForObject;
