import type { ControlType } from "./configuration-types";
import { ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE } from "./configuration-rules";

export type ObjectRotationDeg = { x: number; y: number; z: number };

export const DEFAULT_OBJECT_ROTATION_DEG: ObjectRotationDeg = { x: 0, y: 0, z: 0 };

export type RotationAxisKey = keyof ObjectRotationDeg;

/** 带 v2/v3 的控制类型仅允许改模型朝向 Y；其余 XYZ 均可 */
export const modelRotationAxesForControlType = (
  controlType: ControlType,
): readonly RotationAxisKey[] => {
  const virtualAxes: readonly string[] = ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[controlType];
  if (virtualAxes.includes("v2") || virtualAxes.includes("v3")) {
    return ["y"];
  }
  return ["x", "y", "z"];
};

export const controlTypeAllowsFullModelRotation = (controlType: ControlType): boolean =>
  modelRotationAxesForControlType(controlType).length === 3;

/** 侧栏输入：硬限制到 [0, 360]，不取模；360 保持为 360 */
export const normalizeAngleDeg0to360 = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 360) return 360;
  return Object.is(value, -0) ? 0 : value;
};

/**
 * 场景欧拉 → 工程 deg：取模到 [0, 360)。
 * Babylon 常给出 [-180, 180]，不能硬夹到 0（否则 -90° 会变成 0°）。
 */
export const wrapAngleDeg0to360 = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const wrapped = ((value % 360) + 360) % 360;
  return Object.is(wrapped, -0) ? 0 : wrapped;
};

export const normalizeObjectRotationDeg = (
  value: unknown,
  controlType?: ControlType,
): ObjectRotationDeg => {
  const source =
    value && typeof value === "object"
      ? (value as Partial<Record<RotationAxisKey, unknown>>)
      : {};
  const next: ObjectRotationDeg = {
    x: normalizeAngleDeg0to360(source.x),
    y: normalizeAngleDeg0to360(source.y),
    z: normalizeAngleDeg0to360(source.z),
  };
  if (controlType && !controlTypeAllowsFullModelRotation(controlType)) {
    return { x: 0, y: next.y, z: 0 };
  }
  return next;
};

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;

export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

export const objectRotationDegToRad = (rotation: ObjectRotationDeg): ObjectRotationDeg => ({
  x: degToRad(rotation.x),
  y: degToRad(rotation.y),
  z: degToRad(rotation.z),
});

export const objectRotationRadToDeg = (
  rotation: { x: number; y: number; z: number },
  controlType?: ControlType,
): ObjectRotationDeg => {
  const wrapped = {
    x: wrapAngleDeg0to360(radToDeg(rotation.x)),
    y: wrapAngleDeg0to360(radToDeg(rotation.y)),
    z: wrapAngleDeg0to360(radToDeg(rotation.z)),
  };
  if (controlType && !controlTypeAllowsFullModelRotation(controlType)) {
    return { x: 0, y: wrapped.y, z: 0 };
  }
  return wrapped;
};
