import type {
  ControlType,
  MotionAxisKind,
  MotionAxisParams,
  ShapeDimensionValuesByPreset,
  ShapePresetId,
} from "./configuration-types";
import type { VirtualAxisId } from "./project-document-types";
import { normalizeMotionAxisParams } from "./motion-acceleration";
import {
  normalizeInitialTiltDirection,
  normalizeMountRotation,
  normalizeSafetyRadius,
  type AxisMount,
} from "./hoist-point-defaults";

export type { VirtualAxisId };

export type ControlTypeRule = {
  minimumDriveAxes: number;
  /** 存在时表示驱动轴数量上限；等于 minimumDriveAxes 即固定数量（如四点摆固定 4 吊点） */
  maxDriveAxes?: number;
  motionAxes: readonly MotionAxisKind[];
};

export const CONTROL_TYPE_RULES = {
  singlePointMove: { minimumDriveAxes: 1, motionAxes: ["move"] },
  singlePointRotation: { minimumDriveAxes: 1, motionAxes: ["rotation"] },
  continuousRotation: { minimumDriveAxes: 1, motionAxes: ["rotation"] },
  multiLevelHoist: { minimumDriveAxes: 1, motionAxes: ["move"] },
  railCar: { minimumDriveAxes: 0, motionAxes: [] },
  /** 3D 占位/美化：无吊点、无运动参数 */
  staticProp: { minimumDriveAxes: 0, motionAxes: [] },
  twoPointSwing: { minimumDriveAxes: 2, motionAxes: ["move", "swingX"] },
  fourPointSwing: {
    minimumDriveAxes: 4,
    maxDriveAxes: 4,
    motionAxes: ["move", "swingX", "swingY"],
  },
  dualTiltFourPointSwing: {
    minimumDriveAxes: 4,
    motionAxes: ["move", "swingX", "swingY"],
  },
  multiPointSwing: { minimumDriveAxes: 4, motionAxes: ["move", "swingX", "yawY"] },
} as const satisfies Record<ControlType, ControlTypeRule>;

export const ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE = {
  singlePointMove: ["v1"],
  singlePointRotation: ["v1"],
  continuousRotation: ["v1"],
  multiLevelHoist: ["v1"],
  railCar: [],
  staticProp: [],
  twoPointSwing: ["v1", "v2"],
  fourPointSwing: ["v1", "v2", "v3"],
  dualTiltFourPointSwing: ["v1", "v2", "v3"],
  multiPointSwing: ["v1", "v2", "v3"],
} as const satisfies Record<ControlType, readonly VirtualAxisId[]>;

/** 无驱动轴：轨道车、静态占位等 */
export const controlTypeHasNoDriveAxes = (controlType: ControlType): boolean =>
  CONTROL_TYPE_RULES[controlType].minimumDriveAxes === 0;

/** 驱动轴数量上限；undefined 表示无上限 */
export const maxDriveAxesForControlType = (controlType: ControlType): number | undefined =>
  (CONTROL_TYPE_RULES[controlType] as ControlTypeRule).maxDriveAxes;

/** 安全范围半径、初始倾斜角度：仅多点摆 */
export const controlTypeHasMultiPointSwingParams = (controlType: ControlType): boolean =>
  controlType === "multiPointSwing";

/** 按控制类型补齐/剥离多点摆专有物体级参数 */
export const resolveSwingYawModelParams = (
  controlType: ControlType,
  current?: {
    safetyRadius?: number;
    initialTiltDirection?: number;
    mountRotation?: number;
  },
): {
  safetyRadius?: number;
  initialTiltDirection?: number;
  mountRotation?: number;
} =>
  controlTypeHasMultiPointSwingParams(controlType)
    ? {
        safetyRadius: normalizeSafetyRadius(current?.safetyRadius),
        initialTiltDirection: normalizeInitialTiltDirection(current?.initialTiltDirection),
        mountRotation: normalizeMountRotation(current?.mountRotation),
      }
    : {};

export type DriveAxisConfig = {
  /** 物体内唯一索引字符串，如 "0" / "1"（升降吊点，非语义名） */
  key: string;
  custom?: boolean;
  mount?: AxisMount;
};

/** 分配下一个空闲的物体内驱动轴索引 key（"0","1",…） */
export const nextDriveAxisKey = (axes: readonly { key: string }[]): string => {
  const usedKeys = new Set(axes.map((axis) => axis.key));
  let nextIndex = 0;
  while (usedKeys.has(String(nextIndex))) nextIndex += 1;
  return String(nextIndex);
};

export const ensureMinimumDriveAxes = <T extends DriveAxisConfig>(
  controlType: ControlType,
  axes: readonly T[],
): DriveAxisConfig[] => {
  const usedKeys = new Set<string>();
  for (const axis of axes) {
    if (usedKeys.has(axis.key)) throw new Error(`Duplicate axis key "${axis.key}"`);
    usedKeys.add(axis.key);
  }

  const result: DriveAxisConfig[] = [...axes];
  const minimum = CONTROL_TYPE_RULES[controlType].minimumDriveAxes;
  while (result.length < minimum) {
    const key = nextDriveAxisKey(result);
    usedKeys.add(key);
    result.push({ key, custom: true, mount: { x: 0, z: 0 } });
  }
  return result;
};

export const MOTION_DEFAULTS = {
  move: normalizeMotionAxisParams({
    minAngle: 0,
    maxAngle: 1000,
    speed: 50,
    accelTime: 2,
    minAccelTime: 1,
    emergencyDecelTime: 0.1,
    acceleration: 0,
    deceleration: 0,
    maxAcceleration: 0,
    maxDeceleration: 0,
    abnormalDeceleration: 0,
  }),
  rotation: normalizeMotionAxisParams({
    minAngle: 0,
    maxAngle: 360,
    speed: 30,
    accelTime: 2,
    minAccelTime: 1,
    emergencyDecelTime: 0.1,
    acceleration: 0,
    deceleration: 0,
    maxAcceleration: 0,
    maxDeceleration: 0,
    abnormalDeceleration: 0,
  }),
  swingX: normalizeMotionAxisParams({
    minAngle: -20,
    maxAngle: 20,
    speed: 2,
    accelTime: 3,
    minAccelTime: 1,
    emergencyDecelTime: 0.2,
    acceleration: 0,
    deceleration: 0,
    maxAcceleration: 0,
    maxDeceleration: 0,
    abnormalDeceleration: 0,
  }),
  swingY: normalizeMotionAxisParams({
    minAngle: -20,
    maxAngle: 20,
    speed: 2,
    accelTime: 3,
    minAccelTime: 1,
    emergencyDecelTime: 0.2,
    acceleration: 0,
    deceleration: 0,
    maxAcceleration: 0,
    maxDeceleration: 0,
    abnormalDeceleration: 0,
  }),
  yawY: normalizeMotionAxisParams({
    minAngle: -20,
    maxAngle: 20,
    speed: 2,
    accelTime: 3,
    minAccelTime: 1,
    emergencyDecelTime: 0.2,
    acceleration: 0,
    deceleration: 0,
    maxAcceleration: 0,
    maxDeceleration: 0,
    abnormalDeceleration: 0,
  }),
} satisfies Record<MotionAxisKind, MotionAxisParams>;

export const defaultMotionParamsForControlType = (
  controlType: ControlType,
): Partial<Record<MotionAxisKind, MotionAxisParams>> => {
  const result: Partial<Record<MotionAxisKind, MotionAxisParams>> = {};
  for (const axis of CONTROL_TYPE_RULES[controlType].motionAxes) {
    result[axis] = { ...MOTION_DEFAULTS[axis] };
  }
  return result;
};

type ShapeFieldKeysByPreset = {
  [P in ShapePresetId]: readonly (keyof ShapeDimensionValuesByPreset[P])[];
};

export const SHAPE_DIMENSION_KEYS = {
  cube: ["width", "height", "depth"],
  cyl: ["diameter", "height"],
  sphere: ["diameter"],
  ring: ["outerDiameter", "innerDiameter", "thickness"],
  sqRing: ["outerWidth", "outerDepth", "ringWidth", "thickness"],
  prism6: ["acrossFlats", "height"],
  external: ["width", "height", "depth"],
} as const satisfies ShapeFieldKeysByPreset;
