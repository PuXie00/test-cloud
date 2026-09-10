import type { ControlType } from "./configuration-types";

export type AxisMount = { x: number; z: number };

/** 原点到滑轮距离（轴链条最短长度），单位 mm */
export const DEFAULT_PULLEY_DISTANCE = 100;

/** 模型运行方向：1 正向，2 反向（对齐 PLC modelRunDirection） */
export type ModelRunDirection = 1 | 2;

export const MODEL_RUN_DIRECTIONS = [1, 2] as const satisfies readonly ModelRunDirection[];

export const DEFAULT_MODEL_RUN_DIRECTION: ModelRunDirection = 1;

export const MODEL_RUN_DIRECTION_OPTIONS: ReadonlyArray<{
  value: ModelRunDirection;
  label: string;
}> = [
  { value: 1, label: "正向" },
  { value: 2, label: "反向" },
];

export const normalizeModelRunDirection = (value: unknown): ModelRunDirection =>
  value === 2 ? 2 : DEFAULT_MODEL_RUN_DIRECTION;

/** 安全范围半径，单位 mm（仅多点摆必填） */
export const DEFAULT_SAFETY_RADIUS = 1850;

/** 初始倾斜角度，单位 deg（仅多点摆必填） */
export const DEFAULT_INITIAL_TILT_DIRECTION = 0;
export const MAX_INITIAL_TILT_DIRECTION = 360;

/** 吊点整体旋转，单位 deg（仅多点摆；绕物体原点） */
export const DEFAULT_MOUNT_ROTATION = 0;
export const MAX_MOUNT_ROTATION = 360;

export const normalizeSafetyRadius = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : DEFAULT_SAFETY_RADIUS;

export const normalizeInitialTiltDirection = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_INITIAL_TILT_DIRECTION;
  return Math.min(MAX_INITIAL_TILT_DIRECTION, Math.max(0, value));
};

export const normalizeMountRotation = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MOUNT_ROTATION;
  return Math.min(MAX_MOUNT_ROTATION, Math.max(0, value));
};

/** 默认吊点 mount，单位 mm */
const FOUR_POINT_MOUNTS: AxisMount[] = [
  { x: -400, z: -400 },
  { x: 400, z: -400 },
  { x: 400, z: 400 },
  { x: -400, z: 400 },
];

const MOUNTS_BY_CONTROL_TYPE: Partial<Record<ControlType, AxisMount[]>> = {
  singlePointMove: [{ x: 0, z: 0 }],
  singlePointRotation: [{ x: 0, z: 0 }],
  continuousRotation: [{ x: 0, z: 0 }],
  multiLevelHoist: [{ x: 0, z: 0 }],
  twoPointSwing: [
    { x: -700, z: 0 },
    { x: 700, z: 0 },
  ],
  fourPointSwing: FOUR_POINT_MOUNTS,
  dualTiltFourPointSwing: FOUR_POINT_MOUNTS,
  multiPointSwing: FOUR_POINT_MOUNTS,
  railCar: [],
  staticProp: [],
};

export const defaultMountsForControlType = (controlType: ControlType): AxisMount[] =>
  MOUNTS_BY_CONTROL_TYPE[controlType]?.map((mount) => ({ ...mount })) ?? [];

export const defaultMountForAxisIndex = (
  controlType: ControlType,
  axisIndex: number,
): AxisMount => {
  const mounts = defaultMountsForControlType(controlType);
  return mounts[axisIndex] ? { ...mounts[axisIndex] } : { x: 0, z: 0 };
};
