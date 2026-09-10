import type { MotionAxisKind, MotionAxisParams } from "./configuration-types";
import type { VirtualAxisId } from "./project-document-types";
import { virtualAxisForMotionKind } from "./virtual-axis-mapping";

export const UNBOUND_V1_MAX_VELOCITY = 500;
export const DEFAULT_SWING_AXIS_MAX_VELOCITY = 3;

export type MotorVelocitySource = {
  controlledObjectId: number | null;
  params: Record<string, unknown>;
};

export type VirtualAxisMaxObject = {
  id: number;
  enabledVirtualAxes: readonly VirtualAxisId[];
  pMaxVelocity?: number;
  yMaxVelocity?: number;
};

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const positiveOrDefault = (value: unknown, fallback: number): number =>
  isPositiveFinite(value) ? value : fallback;

export const virtualAxisMaxFieldsFor = (
  enabledVirtualAxes: readonly VirtualAxisId[],
  current?: { pMaxVelocity?: number; yMaxVelocity?: number },
): { pMaxVelocity?: number; yMaxVelocity?: number } => {
  const enabled = new Set(enabledVirtualAxes);
  return {
    ...(enabled.has("v2")
      ? { pMaxVelocity: positiveOrDefault(current?.pMaxVelocity, DEFAULT_SWING_AXIS_MAX_VELOCITY) }
      : {}),
    ...(enabled.has("v3")
      ? { yMaxVelocity: positiveOrDefault(current?.yMaxVelocity, DEFAULT_SWING_AXIS_MAX_VELOCITY) }
      : {}),
  };
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
    if (axis === "v2" && isPositiveFinite(object.pMaxVelocity)) {
      resolved.v2 = object.pMaxVelocity;
      continue;
    }
    if (axis === "v3" && isPositiveFinite(object.yMaxVelocity)) {
      resolved.v3 = object.yMaxVelocity;
    }
  }
  return resolved;
};

export const clampMotionParamsToAxisMax = (
  motionParams: Partial<Record<MotionAxisKind, MotionAxisParams>>,
  motionAxes: readonly MotionAxisKind[],
  resolved: Partial<Record<VirtualAxisId, number>>,
): Partial<Record<MotionAxisKind, MotionAxisParams>> => {
  const next: Partial<Record<MotionAxisKind, MotionAxisParams>> = { ...motionParams };
  for (const axis of motionAxes) {
    const current = next[axis];
    if (!current) continue;
    const cap = resolved[virtualAxisForMotionKind(axis)];
    if (cap === undefined) continue;
    if (current.speed <= cap) continue;
    next[axis] = { ...current, speed: cap };
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
