import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { attachmentFrameMatrix } from "../state/preview-path-points";
import type { SceneObjectConfig, Vec3, VirtualAxisId, VirtualAxisValues } from "../types";
import {
  addVec,
  angleBetween,
  anyPerpendicular,
  crossVec,
  dotVec,
  lengthVec,
  normalizeVec,
  rejectVec,
  scaleVec,
  subVec,
  UP_VEC,
  wrapAngle,
  ZERO_VEC,
} from "./pose-handle-math";
import type { PoseHandleAxisRange } from "./pose-handle-types";

/**
 * 手柄的运动学全部走虚轴正解（resolveVirtualAxisTransform）数值求：
 * 拖动量换成虚轴值时不手写正反向、初始倾斜方向这些符号，挂在别的物体上的也一样算。
 */

export type FullAxisValues = { v1: number; v2: number; v3: number };

export const toFullAxisValues = (values: VirtualAxisValues): FullAxisValues => ({
  v1: values.v1 ?? 0,
  v2: values.v2 ?? 0,
  v3: values.v3 ?? 0,
});

const withAxis = (values: FullAxisValues, axis: VirtualAxisId, value: number): FullAxisValues => ({
  ...values,
  [axis]: value,
});

/** 物体配置、虚轴值、父物体运动枢轴的世界矩阵（没挂载为 null） */
export type PoseKinematics = {
  config: SceneObjectConfig;
  values: FullAxisValues;
  parentWorld: Matrix | null;
};

const withValues = (input: PoseKinematics, values: FullAxisValues): PoseKinematics => ({ ...input, values });

/** 运动枢轴坐标系 → 世界（Babylon 行向量：点 × 矩阵） */
export const poseWorldMatrix = ({ config, values, parentWorld }: PoseKinematics): Matrix => {
  const frame = attachmentFrameMatrix(config, values);
  return parentWorld ? frame.multiply(parentWorld) : frame;
};

const toVec = (vector: Vector3): Vec3 => ({ x: vector.x, y: vector.y, z: vector.z });

export const transformPoint = (matrix: Matrix, point: Vec3): Vec3 =>
  toVec(Vector3.TransformCoordinates(new Vector3(point.x, point.y, point.z), matrix));

export const transformDirection = (matrix: Matrix, direction: Vec3): Vec3 =>
  toVec(Vector3.TransformNormal(new Vector3(direction.x, direction.y, direction.z), matrix));

export const worldPointOf = (input: PoseKinematics, local: Vec3): Vec3 =>
  transformPoint(poseWorldMatrix(input), local);

/** 父物体（没挂载时为世界）的竖直方向：升降沿这个方向 */
export const parentUpOf = (parentWorld: Matrix | null): Vec3 =>
  parentWorld ? (normalizeVec(transformDirection(parentWorld, UP_VEC)) ?? UP_VEC) : UP_VEC;

/** 物体顶面中心（运动枢轴坐标系）：升降箭头、旋转环挂在这里 */
export const localTopCenter = (config: SceneObjectConfig): Vec3 => ({ x: 0, y: config.dimensions.h / 2, z: 0 });

/** 吊点平面中心（运动枢轴坐标系）：倾斜弧、摇杆绕这里 */
export const localHoistCenter = (config: SceneObjectConfig): Vec3 => {
  const mounts = (config.hoistAxes ?? []).map((axis) => axis.mount);
  if (mounts.length === 0) return localTopCenter(config);
  const xs = mounts.map((mount) => mount.x);
  const zs = mounts.map((mount) => mount.z);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: config.dimensions.h / 2,
    z: (Math.min(...zs) + Math.max(...zs)) / 2,
  };
};

/**
 * 数值微分步长：虚轴 1 为 10 mm / 10°（升降、旋转对它是线性的，步长大些抵掉 Babylon 矩阵的单精度误差），
 * 虚轴 2、3 为 0.5°
 */
const STEP: Record<VirtualAxisId, number> = { v1: 10, v2: 0.5, v3: 0.5 };

/** 局部点随一根轴每变一个单位在世界里移动多少（米 / 单位，中心差分） */
export const pointRateOf = (input: PoseKinematics, axis: VirtualAxisId, local: Vec3): Vec3 => {
  const step = STEP[axis];
  const value = input.values[axis];
  const minus = worldPointOf(withValues(input, withAxis(input.values, axis, value - step)), local);
  const plus = worldPointOf(withValues(input, withAxis(input.values, axis, value + step)), local);
  return scaleVec(subVec(plus, minus), 1 / (2 * step));
};

const BASIS: readonly Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
];

/**
 * 两个姿态之间的转动：转轴（世界单位向量）和转角（弧度，0..π）。
 * 用三根基向量前后的叉积和：Σ e×Re = 2 sinθ · 轴，Σ e·Re = 1 + 2 cosθ。
 */
const rotationBetween = (from: Matrix, to: Matrix): { axis: Vec3; angle: number } | null => {
  let sum = ZERO_VEC;
  let cosSum = 0;
  for (const basis of BASIS) {
    const before = normalizeVec(transformDirection(from, basis));
    const after = normalizeVec(transformDirection(to, basis));
    if (!before || !after) return null;
    sum = addVec(sum, crossVec(before, after));
    cosSum += dotVec(before, after);
  }
  const sin = lengthVec(sum) / 2;
  const angle = Math.atan2(sin, (cosSum - 1) / 2);
  const axis = normalizeVec(sum);
  return axis && angle > 1e-9 ? { axis, angle } : null;
};

/** 一根轴每变一个单位物体转多少：正向转轴（右手定则）和弧度 / 单位；这根轴不带转动时 null */
export type AngularRate = { axis: Vec3; rate: number };

export const angularRateOf = (input: PoseKinematics, axis: VirtualAxisId): AngularRate | null => {
  const step = STEP[axis];
  const value = input.values[axis];
  const minus = poseWorldMatrix(withValues(input, withAxis(input.values, axis, value - step)));
  const plus = poseWorldMatrix(withValues(input, withAxis(input.values, axis, value + step)));
  const rotation = rotationBetween(minus, plus);
  return rotation ? { axis: rotation.axis, rate: rotation.angle / (2 * step) } : null;
};

/** 板面法线：运动枢轴局部 +Y 的世界方向 */
export const plateNormalOf = (input: PoseKinematics): Vec3 =>
  normalizeVec(transformDirection(poseWorldMatrix(input), UP_VEC)) ?? UP_VEC;

/** 物体朝前（局部 +Z，朝向标记那一面）的世界方向 */
export const frontDirectionOf = (input: PoseKinematics): Vec3 =>
  normalizeVec(transformDirection(poseWorldMatrix(input), { x: 0, y: 0, z: 1 })) ?? { x: 0, y: 0, z: 1 };

const restValues = (values: FullAxisValues): FullAxisValues => ({ ...values, v2: 0, v3: 0 });

/** 不倾斜时的板面法线 */
export const restNormalOf = (input: PoseKinematics): Vec3 =>
  plateNormalOf(withValues(input, restValues(input.values)));

/** 倾斜量取哪一边：沿用起点的正负；起点为 0 时行程只允许负值才取负 */
const tiltSignOf = (current: number, range?: PoseHandleAxisRange): 1 | -1 => {
  if (current > 1e-9) return 1;
  if (current < -1e-9) return -1;
  return range && range.max <= 0 && range.min < 0 ? -1 : 1;
};

/** 角度值超出行程时换一圈试试（方向角允许多圈），取进范围里离原值最近的 */
export const fitAngleToRange = (value: number, range?: PoseHandleAxisRange): number => {
  if (!range || (value >= range.min && value <= range.max)) return value;
  let best: number | null = null;
  for (let turns = -8; turns <= 8; turns += 1) {
    const candidate = value + turns * 360;
    if (candidate < range.min || candidate > range.max) continue;
    if (best === null || Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
  }
  return best ?? value;
};

/** 摇杆试探用的倾斜量（度） */
const PROBE_TILT_DEG = 10;
/** 比这更接近竖直就算放平 */
const LEVEL_EPSILON_RAD = (0.05 * Math.PI) / 180;

export type SwingRanges = { v2?: PoseHandleAxisRange; v3?: PoseHandleAxisRange };

/**
 * 多点摆摇杆：要让板面法线指向 target（世界单位向量）时的虚轴 2（倾斜量）和虚轴 3（倾斜方向）。
 * 倾斜量按正解里「倾斜角对 v2 的变化率」换算，方向按「倾斜方向对 v3 的变化率」换算，
 * v3 取离起点最近的那一圈；接近竖直时放平、方向不变。
 */
export const solveSwingTowards = (
  input: PoseKinematics,
  target: Vec3,
  ranges: SwingRanges = {},
): { v2: number; v3: number } => {
  const { values } = input;
  const rest = restNormalOf(input);
  const polar = angleBetween(rest, target);
  if (polar < LEVEL_EPSILON_RAD) return { v2: 0, v3: values.v3 };

  const normalAt = (v2: number, v3: number) => plateNormalOf(withValues(input, { ...values, v2, v3 }));
  const probe = tiltSignOf(values.v2, ranges.v2) * PROBE_TILT_DEG;
  const probePolar = angleBetween(rest, normalAt(probe, values.v3));
  if (probePolar < 1e-9) return { v2: values.v2, v3: values.v3 };
  const v2 = (polar / probePolar) * probe;

  const restFrame = poseWorldMatrix(withValues(input, restValues(values)));
  const e1 =
    normalizeVec(rejectVec(transformDirection(restFrame, { x: 1, y: 0, z: 0 }), rest)) ?? anyPerpendicular(rest);
  const e2 = crossVec(rest, e1);
  const azimuth = (normal: Vec3) => Math.atan2(dotVec(normal, e2), dotVec(normal, e1));
  const azimuthAt = (v3: number) => azimuth(normalAt(probe, v3));
  const slope = wrapAngle(azimuthAt(values.v3 + 1) - azimuthAt(values.v3 - 1)) / 2;
  if (Math.abs(slope) < 1e-9) return { v2, v3: values.v3 };
  const v3 = values.v3 + wrapAngle(azimuth(target) - azimuthAt(values.v3)) / slope;
  return { v2, v3: fitAngleToRange(v3, ranges.v3) };
};
