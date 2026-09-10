import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

export const ROTATION_XY_ORDER = "YXZ" as const;

export type RotationAxisKey = "x" | "y" | "z";

export type RotationEuler = { x: number; y: number; z: number };

/** @deprecated Prefer RotationEuler; kept for XY-only call sites */
export type RotationXY = { x: number; y: number };

export const ALL_MODEL_ROTATION_AXES: readonly RotationAxisKey[] = ["x", "y", "z"];

export const resolveModelRotationAxes = (
  axes: readonly RotationAxisKey[] | undefined,
): readonly RotationAxisKey[] =>
  axes && axes.length > 0 ? axes : ALL_MODEL_ROTATION_AXES;

export const intersectModelRotationAxes = (
  lists: readonly (readonly RotationAxisKey[])[],
): RotationAxisKey[] => {
  if (lists.length === 0) return [];
  return ALL_MODEL_ROTATION_AXES.filter((axis) => lists.every((list) => list.includes(axis)));
};

const sameRotationAxes = (
  left: readonly RotationAxisKey[],
  right: readonly RotationAxisKey[],
): boolean =>
  left.length === right.length && left.every((axis, index) => axis === right[index]);

export const rotationAxesEqual = sameRotationAxes;

const readQuaternion = (object: TransformNode): Quaternion => {
  if (object.rotationQuaternion) {
    return object.rotationQuaternion.clone();
  }
  return Quaternion.FromEulerAngles(object.rotation.x, object.rotation.y, object.rotation.z);
};

export const extractRotationEuler = (object: TransformNode): RotationEuler => {
  const euler = readQuaternion(object).toEulerAngles();
  return { x: euler.x, y: euler.y, z: euler.z };
};

export const extractRotationXY = (object: TransformNode): RotationXY => {
  const { x, y } = extractRotationEuler(object);
  return { x, y };
};

export const extractRotationY = (object: TransformNode): number => extractRotationXY(object).y;

export const unwrapAngle = (angle: number, reference: number): number => {
  let value = angle;
  let delta = value - reference;
  while (delta > Math.PI) {
    value -= 2 * Math.PI;
    delta = value - reference;
  }
  while (delta < -Math.PI) {
    value += 2 * Math.PI;
    delta = value - reference;
  }
  return value;
};

/** Bake gizmo quaternion into Euler once (do not call every drag frame). */
export const bakeRotationQuaternionToEuler = (object: TransformNode): RotationEuler => {
  if (!object.rotationQuaternion) {
    return {
      x: object.rotation.x,
      y: object.rotation.y,
      z: object.rotation.z,
    };
  }
  const euler = object.rotationQuaternion.toEulerAngles();
  object.rotationQuaternion = null;
  object.rotation.set(euler.x, euler.y, euler.z);
  return { x: euler.x, y: euler.y, z: euler.z };
};

/**
 * Keep only allowed Euler axes; disallowed axes forced to 0.
 * Intended for attach / commit — not mid-drag (fights world-space rotation gizmo).
 */
export const constrainRotationAxes = (
  object: TransformNode,
  allowed: readonly RotationAxisKey[],
  reference?: Partial<RotationEuler>,
): RotationEuler => {
  let { x, y, z } = bakeRotationQuaternionToEuler(object);
  const allowX = allowed.includes("x");
  const allowY = allowed.includes("y");
  const allowZ = allowed.includes("z");

  if (!allowX) {
    x = 0;
  } else if (reference?.x !== undefined) {
    x = unwrapAngle(x, reference.x);
  }
  if (!allowY) {
    y = 0;
  } else if (reference?.y !== undefined) {
    y = unwrapAngle(y, reference.y);
  }
  if (!allowZ) {
    z = 0;
  } else if (reference?.z !== undefined) {
    z = unwrapAngle(z, reference.z);
  }

  object.rotationQuaternion = null;
  object.rotation.set(x, y, z);
  return { x, y, z };
};

/** Project orientation onto world X/Y; returns applied angles (radians). */
export const constrainRotationXY = (
  object: TransformNode,
  reference?: Partial<RotationXY>,
): RotationXY => {
  const next = constrainRotationAxes(object, ["x", "y"], reference);
  return { x: next.x, y: next.y };
};

/** @deprecated Use constrainRotationXY */
export const constrainRotationY = (object: TransformNode, referenceY?: number): number =>
  constrainRotationXY(object, referenceY !== undefined ? { y: referenceY } : undefined).y;
