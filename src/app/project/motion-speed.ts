import type {
  MotionAxisId,
  MotionAxisKind,
  MotionAxisParams,
  MotionParamsByAxis,
} from "./configuration-types";
import { MOTION_DEFAULTS } from "./configuration-rules";
import { normalizeMotionAxisParams } from "./motion-acceleration";
import type { VirtualAxisId } from "./project-document-types";
import { motionAxisIdForKind, virtualAxisForMotionKind } from "./virtual-axis-mapping";

export type MotionSpeedOverride = {
  enabled: boolean;
  speed?: number;
};

export type MotionSpeedControl = {
  speedRatio: number;
  overrides?: Partial<Record<MotionAxisId, MotionSpeedOverride>>;
};

/** 物体级最大轴速度默认值（mm/s），对齐描述文件 maxAxisVelocity */
export const DEFAULT_MAX_AXIS_VELOCITY = 200;

/**
 * 以 DEFAULT_MAX_AXIS_VELOCITY 为基准时，各虚轴最大速度的相对比例。
 * 派生虚轴运行上限：maxAxisVelocity * factor。
 */
const AXIS_MAX_VELOCITY_FACTOR: Record<MotionAxisKind, number> = {
  move: 1,
  rotation: 60 / 200,
  swingX: 3 / 200,
  swingY: 3 / 200,
  yawY: 3 / 200,
};

const AXIS_SPEED_FACTOR: Record<MotionAxisKind, number> = {
  move: MOTION_DEFAULTS.move.speed / DEFAULT_MAX_AXIS_VELOCITY,
  rotation: MOTION_DEFAULTS.rotation.speed / DEFAULT_MAX_AXIS_VELOCITY,
  swingX: MOTION_DEFAULTS.swingX.speed / DEFAULT_MAX_AXIS_VELOCITY,
  swingY: MOTION_DEFAULTS.swingY.speed / DEFAULT_MAX_AXIS_VELOCITY,
  yawY: MOTION_DEFAULTS.yawY.speed / DEFAULT_MAX_AXIS_VELOCITY,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const round1 = (value: number) => Math.round(value * 10) / 10;

/** 只保留仍沿用原参数的轴的自定义速度；被重置或已不存在的轴丢掉 */
export const keepSpeedOverrides = (
  control: MotionSpeedControl | undefined,
  keptAxisIds: readonly MotionAxisId[],
): MotionSpeedControl | undefined => {
  if (!control?.overrides) return control;
  const overrides: Partial<Record<MotionAxisId, MotionSpeedOverride>> = {};
  for (const id of keptAxisIds) {
    const override = control.overrides[id];
    if (override) overrides[id] = override;
  }
  return { ...control, overrides };
};

export const normalizeMaxAxisVelocity = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return DEFAULT_MAX_AXIS_VELOCITY;
};

export const deriveAxisMaxVelocity = (
  maxAxisVelocity: number,
  axis: MotionAxisKind,
): number => round1(maxAxisVelocity * AXIS_MAX_VELOCITY_FACTOR[axis]);

/** 速度比例以升降轴为基准推断；h 不是升降（如旋转）时按默认升降速度算 */
export const inferMotionSpeedControl = (
  motionParams: MotionParamsByAxis | undefined,
  maxAxisVelocity: number | undefined,
  motionAxes: readonly MotionAxisKind[],
): MotionSpeedControl => {
  const moveSpeed = motionAxes.includes("move") ? motionParams?.h?.speed : undefined;
  const baseSpeed = moveSpeed ?? MOTION_DEFAULTS.move.speed;
  const defaultBaseSpeed =
    (maxAxisVelocity ?? DEFAULT_MAX_AXIS_VELOCITY) * AXIS_SPEED_FACTOR.move;
  const speedRatio = defaultBaseSpeed > 0 ? round1(baseSpeed / defaultBaseSpeed) : 1;

  return {
    speedRatio: clamp(speedRatio, 0.2, 1.5),
  };
};

export const deriveMotionAxisParams = (
  axis: MotionAxisKind,
  current: MotionAxisParams,
  control: MotionSpeedControl,
  maxAxisVelocity: number,
  resolvedMaxByAxis: Partial<Record<VirtualAxisId, number>>,
): MotionAxisParams => {
  const axisMax =
    resolvedMaxByAxis[virtualAxisForMotionKind(axis)] ??
    deriveAxisMaxVelocity(maxAxisVelocity, axis);
  const speed = round1(
    clamp(maxAxisVelocity * AXIS_SPEED_FACTOR[axis] * control.speedRatio, 0, axisMax),
  );
  const override = control.overrides?.[motionAxisIdForKind(axis)];

  const next = override?.enabled
    ? normalizeMotionAxisParams({
        ...current,
        speed: override.speed ?? speed,
      })
    : normalizeMotionAxisParams({
        ...current,
        speed,
      });

  if (next.speed > axisMax) {
    return normalizeMotionAxisParams({ ...next, speed: axisMax });
  }
  return next;
};

export const deriveMotionParamsFromSpeedControl = (
  motionParams: MotionParamsByAxis,
  axes: readonly MotionAxisKind[],
  control: MotionSpeedControl,
  maxAxisVelocity: number,
  resolvedMaxByAxis: Partial<Record<VirtualAxisId, number>>,
): MotionParamsByAxis => {
  const next: MotionParamsByAxis = { ...motionParams };

  for (const kind of axes) {
    const id = motionAxisIdForKind(kind);
    const current = motionParams[id] ?? MOTION_DEFAULTS[kind];
    next[id] = deriveMotionAxisParams(
      kind,
      current,
      control,
      maxAxisVelocity,
      resolvedMaxByAxis,
    );
  }

  return next;
};
