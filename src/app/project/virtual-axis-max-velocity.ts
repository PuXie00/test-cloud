import type {
  MotionAxisId,
  MotionAxisParams,
  MotionParamsByAxis,
} from "./configuration-types";
import type { VirtualAxisId } from "./project-document-types";
import {
  MOTION_AXIS_IDS,
  motionAxisIdForVirtualAxis,
  virtualAxisForMotionAxisId,
} from "./virtual-axis-mapping";

export const UNBOUND_V1_MAX_VELOCITY = 500;
export const DEFAULT_SWING_AXIS_MAX_VELOCITY = 3;

export type MotorVelocitySource = {
  controlledObjectId: number | null;
  params: Record<string, unknown>;
};

export type VirtualAxisMaxObject = {
  id: number;
  enabledVirtualAxes: readonly VirtualAxisId[];
  motionParams?: MotionParamsByAxis;
};

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const positiveOrDefault = (value: unknown, fallback: number): number =>
  isPositiveFinite(value) ? value : fallback;

/** p / y（虚轴 2/3）带 defaultMaxVelocity；h（虚轴 1，升降/旋转）不带 */
export const motionAxisHasDefaultMaxVelocity = (id: MotionAxisId): boolean => id !== "h";

/** p / y 补齐正的 defaultMaxVelocity，h 去掉该字段 */
export const normalizeAxisDefaultMaxVelocity = (
  id: MotionAxisId,
  params: MotionAxisParams,
): MotionAxisParams => {
  const { defaultMaxVelocity, ...rest } = params;
  if (!motionAxisHasDefaultMaxVelocity(id)) return rest;
  return {
    ...rest,
    defaultMaxVelocity: positiveOrDefault(defaultMaxVelocity, DEFAULT_SWING_AXIS_MAX_VELOCITY),
  };
};

/** 读取虚轴 2/3 在 motionParams 中配置的最大速度 */
export const swingAxisMaxVelocityOf = (
  motionParams: MotionParamsByAxis | undefined,
  axis: "v2" | "v3",
): number | undefined => {
  const value = motionParams?.[motionAxisIdForVirtualAxis(axis)]?.defaultMaxVelocity;
  return isPositiveFinite(value) ? value : undefined;
};

/** 写入虚轴 2/3 的最大速度；motionParams 中无对应轴时原样返回 */
export const withSwingAxisMaxVelocity = (
  motionParams: MotionParamsByAxis,
  axis: "v2" | "v3",
  value: number,
): MotionParamsByAxis => {
  const id = motionAxisIdForVirtualAxis(axis);
  const params = motionParams[id];
  if (!params) return motionParams;
  return { ...motionParams, [id]: { ...params, defaultMaxVelocity: value } };
};

const v1MaxFromMotors = (
  objectId: number,
  motors: readonly MotorVelocitySource[],
): number => {
  let min: number | undefined;
  for (const motor of motors) {
    if (motor.controlledObjectId !== objectId) continue;
    const value = motor.params.maxAxisVelocity;
    if (!isPositiveFinite(value)) continue;
    min = min === undefined ? value : Math.min(min, value);
  }
  return min ?? UNBOUND_V1_MAX_VELOCITY;
};

export const resolveVirtualAxisMaxVelocity = (
  object: VirtualAxisMaxObject,
  motors: readonly MotorVelocitySource[],
): Partial<Record<VirtualAxisId, number>> => {
  const resolved: Partial<Record<VirtualAxisId, number>> = {};
  for (const axis of object.enabledVirtualAxes) {
    if (axis === "v1") {
      resolved.v1 = v1MaxFromMotors(object.id, motors);
      continue;
    }
    const max = swingAxisMaxVelocityOf(object.motionParams, axis);
    if (max !== undefined) resolved[axis] = max;
  }
  return resolved;
};

export const clampMotionParamsToAxisMax = (
  motionParams: MotionParamsByAxis,
  resolved: Partial<Record<VirtualAxisId, number>>,
): MotionParamsByAxis => {
  const next: MotionParamsByAxis = { ...motionParams };
  for (const id of MOTION_AXIS_IDS) {
    const current = next[id];
    if (!current) continue;
    const cap = resolved[virtualAxisForMotionAxisId(id)];
    if (cap === undefined) continue;
    if (current.speed <= cap) continue;
    next[id] = { ...current, speed: cap };
  }
  return next;
};

export const resolveJogAxisMaxVelocity = (
  axis: VirtualAxisId,
  objects: readonly VirtualAxisMaxObject[],
  motors: readonly MotorVelocitySource[],
): number | undefined => {
  let min: number | undefined;
  for (const object of objects) {
    const cap = resolveVirtualAxisMaxVelocity(object, motors)[axis];
    if (cap === undefined) continue;
    min = min === undefined ? cap : Math.min(min, cap);
  }
  return min;
};
