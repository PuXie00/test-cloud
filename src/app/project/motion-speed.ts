import type { MotionAxisKind, MotionAxisParams } from "./configuration-types";
import { MOTION_DEFAULTS } from "./configuration-rules";
import { normalizeMotionAxisParams } from "./motion-acceleration";
import type { VirtualAxisId } from "./project-document-types";
import { virtualAxisForMotionKind } from "./virtual-axis-mapping";

export type MotionSpeedOverride = {
  enabled: boolean;
  speed?: number;
};

export type MotionSpeedControl = {
  speedRatio: number;
  overrides?: Partial<Record<MotionAxisKind, MotionSpeedOverride>>;
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

export const normalizeMaxAxisVelocity = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return DEFAULT_MAX_AXIS_VELOCITY;
};

export const deriveAxisMaxVelocity = (
  maxAxisVelocity: number,
  axis: MotionAxisKind,
): number => round1(maxAxisVelocity * AXIS_MAX_VELOCITY_FACTOR[axis]);

export const inferMotionSpeedControl = (
  motionParams: Partial<Record<MotionAxisKind, MotionAxisParams>> | undefined,
  maxAxisVelocity: number = DEFAULT_MAX_AXIS_VELOCITY,
): MotionSpeedControl => {
  const baseSpeed = motionParams?.move?.speed ?? MOTION_DEFAULTS.move.speed;
  const defaultBaseSpeed = maxAxisVelocity * AXIS_SPEED_FACTOR.move;
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
  const override = control.overrides?.[axis];

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
  motionParams: Partial<Record<MotionAxisKind, MotionAxisParams>>,
  axes: readonly MotionAxisKind[],
  control: MotionSpeedControl,
  maxAxisVelocity: number,
  resolvedMaxByAxis: Partial<Record<VirtualAxisId, number>>,
): Partial<Record<MotionAxisKind, MotionAxisParams>> => {
  const next: Partial<Record<MotionAxisKind, MotionAxisParams>> = { ...motionParams };

  for (const axis of axes) {
    const current = motionParams[axis] ?? MOTION_DEFAULTS[axis];
    next[axis] = deriveMotionAxisParams(
      axis,
      current,
      control,
      maxAxisVelocity,
      resolvedMaxByAxis,
    );
  }

  return next;
};
