import { CONTROL_TYPE_RULES } from "@/app/project/configuration-rules";
import type {
  ControlType,
  MotionAxisId,
  MotionAxisParams,
} from "@/app/project/configuration-types";
import { motionKindForAxisId } from "@/app/project/virtual-axis-mapping";
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

const originDistances = (object: ControlledObject): { origin_distance1: number; origin_distance2: number } =>
  object.modelRunDirection === 2
    ? { origin_distance1: 0, origin_distance2: object.pulleyDistance }
    : { origin_distance1: object.pulleyDistance, origin_distance2: 0 };

/** 只取该控制类型实际有的运动轴；旋转类物体的 h 不是升降，不给求解器 */
const solverAxisParams = (
  object: ControlledObject,
  id: MotionAxisId,
): MotionAxisParams | undefined => {
  const kind = motionKindForAxisId(CONTROL_TYPE_RULES[object.controlType].motionAxes, id);
  if (kind === undefined || kind === "rotation") return undefined;
  return object.motionParams?.[id];
};

/** 吊点按 PLC 平面坐标 [x, z, 0]，与 hangingPointArray 同序 */
const hoistPoints = (object: ControlledObject): number[][] =>
  object.axes.map((axis) => [axis.mount.x, axis.mount.z, 0]);

/** 安全半径：多点摆取配置值；多点倾斜没有该配置，取物体底面外接圆半径 */
const rimForType = (object: ControlledObject, type: SolverTypeCode): number[] => {
  if (type === 9) return [Math.hypot(object.dimensions.w, object.dimensions.d) / 2];
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
    params: hoistPoints(input.object),
    motor_H: bound.map((motor) => input.motorPositions.get(motor.id) ?? 0),
    // motor_H: bound.map((motor) => 0),
    limit_data: [
      axisLimit(solverAxisParams(input.object, "h")),
      axisLimit(solverAxisParams(input.object, "p")),
      axisLimit(solverAxisParams(input.object, "y")),
    ],
    limit_rim: rimForType(input.object, type),
    betainit: type === 7 ? (input.object.initialTiltDirection ?? 0) : 0,
    HPY: [input.hpy[0], input.hpy[1], input.hpy[2]],
    // HPY: [0, 0, 0],
  };
};

export const needsSolverExe = (controlType: ControlType): boolean =>
  encodeSolverType(controlType) !== null;

export const objectMotorsInAxisOrder = motorsForObject;
