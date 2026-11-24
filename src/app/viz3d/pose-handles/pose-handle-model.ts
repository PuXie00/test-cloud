import type { Vec3, VirtualAxisId } from "../types";
import {
  angularRateOf,
  frontDirectionOf,
  localHoistCenter,
  localTopCenter,
  parentUpOf,
  plateNormalOf,
  poseWorldMatrix,
  restNormalOf,
  transformDirection,
  worldPointOf,
  type PoseKinematics,
} from "./pose-handle-kinematics";
import { anyPerpendicular, crossVec, dotVec, normalizeVec, rejectVec } from "./pose-handle-math";
import type { PoseHandleAxisRange, PoseHandleKind } from "./pose-handle-types";

/** 升降箭头：挂在顶面中心，沿父物体竖直方向；行程两端是 v1 取上下限时顶面中心的位置 */
export type LiftHandleModel = {
  kind: "lift";
  anchor: Vec3;
  up: Vec3;
  travel: { min: Vec3; max: Vec3 } | null;
};

/** 旋转环 / 倾斜弧：绕 axis（右手定则，值增大的方向）转；ref 是手柄圆头的方向 */
export type RingHandleModel = {
  kind: "yaw" | "tiltX" | "tiltY";
  axis: VirtualAxisId;
  center: Vec3;
  rotationAxis: Vec3;
  radius: number;
  ref: Vec3;
  /** 只画一段弧时相对 ref 的起止角（弧度）；整圈为 null */
  arc: readonly [number, number] | null;
};

/** 摇杆：从吊点平面中心沿板面法线伸出；up 是不倾斜时的法线 */
export type SwingHandleModel = {
  kind: "swing";
  center: Vec3;
  normal: Vec3;
  up: Vec3;
};

export type PoseHandleModel = LiftHandleModel | RingHandleModel | SwingHandleModel;

const RING_AXIS: Record<"yaw" | "tiltX" | "tiltY", VirtualAxisId> = { yaw: "v1", tiltX: "v2", tiltY: "v3" };

/** 倾斜弧只画上面一段：±70° */
const TILT_ARC: readonly [number, number] = [(-70 * Math.PI) / 180, (70 * Math.PI) / 180];

/** 物体沿世界方向 direction 的半宽（按尺寸盒） */
const halfExtentAlong = (input: PoseKinematics, direction: Vec3): number => {
  const frame = poseWorldMatrix(input);
  const { w, h, d } = input.config.dimensions;
  const axes: Array<[Vec3, number]> = [
    [{ x: 1, y: 0, z: 0 }, w / 2],
    [{ x: 0, y: 1, z: 0 }, h / 2],
    [{ x: 0, y: 0, z: 1 }, d / 2],
  ];
  return axes.reduce((sum, [local, half]) => {
    const world = normalizeVec(transformDirection(frame, local)) ?? local;
    return sum + Math.abs(dotVec(world, direction)) * half;
  }, 0);
};

const MIN_RADIUS_M = 0.15;

const liftModel = (input: PoseKinematics, range?: PoseHandleAxisRange): LiftHandleModel => {
  const local = localTopCenter(input.config);
  const anchorAt = (v1: number) => worldPointOf({ ...input, values: { ...input.values, v1 } }, local);
  return {
    kind: "lift",
    anchor: worldPointOf(input, local),
    up: parentUpOf(input.parentWorld),
    travel:
      range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.max > range.min
        ? { min: anchorAt(range.min), max: anchorAt(range.max) }
        : null,
  };
};

const ringModel = (kind: "yaw" | "tiltX" | "tiltY", input: PoseKinematics): RingHandleModel | null => {
  const axis = RING_AXIS[kind];
  const rate = angularRateOf(input, axis);
  if (!rate) return null;
  const rotationAxis = rate.axis;
  if (kind === "yaw") {
    const ref = normalizeVec(rejectVec(frontDirectionOf(input), rotationAxis)) ?? anyPerpendicular(rotationAxis);
    const { w, d } = input.config.dimensions;
    return {
      kind,
      axis,
      center: worldPointOf(input, localTopCenter(input.config)),
      rotationAxis,
      radius: Math.max(MIN_RADIUS_M, (Math.max(w, d) / 2) * 1.15),
      ref,
      arc: null,
    };
  }
  const ref = normalizeVec(rejectVec(plateNormalOf(input), rotationAxis)) ?? anyPerpendicular(rotationAxis);
  const sweep = crossVec(rotationAxis, ref);
  // 两道弧半径错开，免得在顶上交在一起
  const factor = kind === "tiltX" ? 1.3 : 1.08;
  return {
    kind,
    axis,
    center: worldPointOf(input, localHoistCenter(input.config)),
    rotationAxis,
    radius: Math.max(MIN_RADIUS_M, halfExtentAlong(input, sweep) * factor),
    ref,
    arc: TILT_ARC,
  };
};

const swingModel = (input: PoseKinematics): SwingHandleModel => ({
  kind: "swing",
  center: worldPointOf(input, localTopCenter(input.config)),
  normal: plateNormalOf(input),
  up: restNormalOf(input),
});

/** 这台物体这种手柄在世界里的样子；这根轴不带转动（如多点倾斜放平时没有方向）时 null */
export const poseHandleModel = (
  kind: PoseHandleKind,
  input: PoseKinematics,
  ranges?: Partial<Record<VirtualAxisId, PoseHandleAxisRange>>,
): PoseHandleModel | null => {
  switch (kind) {
    case "lift":
      return liftModel(input, ranges?.v1);
    case "swing":
      return swingModel(input);
    default:
      return ringModel(kind, input);
  }
};
