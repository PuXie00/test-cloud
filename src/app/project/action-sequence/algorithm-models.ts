import { CONTROL_TYPE_RULES } from "@/app/project/configuration-rules";
import { decodeControlType } from "@/app/project/control-type-code";
import type {
  ControlledObjectConfig,
  DriveAxisBinding,
  MotorConfig,
  VirtualAxisId,
} from "@/app/project/project-document-types";
import {
  motionAxisIdForVirtualAxis,
  motionParamsOfKind,
} from "@/app/project/virtual-axis-mapping";
import { resolveVirtualAxisMaxVelocity } from "@/app/project/virtual-axis-max-velocity";
import {
  COEFFICIENT_NAMES,
  type ActionSegment,
  type AlgorithmModel,
  type AlgorithmSettings,
  type AxisName,
  type CoefficientName,
  type CoefficientPiece,
  type Hpy,
  type RuntimeModelState,
} from "./algorithm-params";
import { trapezoidToCurveSegments } from "./curve-segments";
import type { HpyPose } from "./nearest-start-motion";
import {
  objectAxisMotions,
  uncontrolledAxesOf,
  type ResolvedActionSequence,
} from "./resolve-sequence";
import { comb } from "./speed-interval";

/**
 * 把工程里的一条动作序列整理成 python 算法共用的 models（算法参数.json 的格式）：
 * 曲线与下发 PLC 的分段相同（100ms 曲线变量），每个原动作段 = 两个相邻位姿之间，
 * 物体最后一个位姿之后保持到序列总时长。序列不控制、物体未启用的轴固定在实时位置。
 */

/** 三个算法共用的静态设置；系数时间单位与 PLC 曲线一致为 100ms */
export const ALGORITHM_SETTINGS: AlgorithmSettings = {
  forced_coefficient_time_unit_ms: 100,
  model_type_scheme: "business",
  coarse_step_ms: 100,
  fine_step_ms: 10,
};

const AXES: readonly VirtualAxisId[] = ["v1", "v2", "v3"];

const AXIS_NAME: Record<VirtualAxisId, AxisName> = { v1: "H", v2: "P", v3: "Y" };

/** 曲线变量每增加 1 是 100ms */
const TICK_MS = 100;

const CONSTANT_EPSILON = 1e-9;

/** 当前位置与固定曲线相差超过此值时，该轴要加入准备轴（对齐 _prepare_targets 的 1e-5） */
const PREPARE_EPSILON = 1e-5;

type Coefficients = [number, number, number, number, number, number];

type AxisPiece = { start: number; end: number; coefficients: Coefficients };

const mountOf = (axis: DriveAxisBinding): { x: number; z: number } => axis.mount ?? { x: 0, z: 0 };

const positive = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;

/** 业务模型类型：2 单点、6 两点、7 四点、8 多点；其余单轴物体都按单点 */
const businessModelType = (object: ControlledObjectConfig): 2 | 6 | 7 | 8 => {
  switch (decodeControlType(object.controlType)) {
    case "twoPointSwing":
      return 6;
    case "fourPointSwing":
    case "dualTiltFourPointSwing":
      return 7;
    case "multiPointSwing":
      return 8;
    default:
      return 2;
  }
};

/** 两点、四点按正解固定 2、4 个吊点；多点按吊点数；单点至少 1 个 */
const motorCountOf = (modelType: 2 | 6 | 7 | 8, object: ControlledObjectConfig): number => {
  if (modelType === 6) return 2;
  if (modelType === 7) return 4;
  if (modelType === 8) return object.driveAxes.length;
  return Math.max(1, object.driveAxes.length);
};

const paramsFor = (object: ControlledObjectConfig, axis: VirtualAxisId) =>
  object.motionParams[motionAxisIdForVirtualAxis(axis)];

/** 最大速度取虚轴最大速度，最大加减速度 = 最大速度 / 最短加速时间 */
const maxVadFor = (
  object: ControlledObjectConfig,
  motors: readonly MotorConfig[],
  axis: VirtualAxisId,
): [number, number, number] => {
  const params = paramsFor(object, axis);
  if (!object.enabledVirtualAxes.includes(axis) || !params) return [0, 0, 0];
  const velocity = resolveVirtualAxisMaxVelocity(object, motors)[axis] ?? params.speed;
  const acceleration = params.minAccelTime > 0 ? velocity / params.minAccelTime : 0;
  return [velocity, acceleration, acceleration];
};

/** 正常速度与加速度（减速度同加速度），不超过最大值 */
const defaultVadFor = (
  object: ControlledObjectConfig,
  axis: VirtualAxisId,
  max: [number, number, number],
): [number, number, number] => {
  const params = paramsFor(object, axis);
  if (!object.enabledVirtualAxes.includes(axis) || !params) return [0, 0, 0];
  const clamp = (value: number, limit: number) =>
    Number.isFinite(value) && value > 0 ? Math.min(value, limit) : 0;
  return [
    clamp(params.speed, max[0]),
    clamp(params.acceleration, max[1]),
    clamp(params.acceleration, max[2]),
  ];
};

/** 吊点电机的最大速度取各电机最小值；没有绑定电机时用物体配置 */
const maxMotorVelocityFor = (
  object: ControlledObjectConfig,
  motors: readonly MotorConfig[],
): number => {
  let min: number | undefined;
  for (const motor of motors) {
    if (motor.controlledObjectId !== object.id) continue;
    const value = motor.params.maxAxisVelocity;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    min = min === undefined ? value : Math.min(min, value);
  }
  if (min !== undefined) return min;
  return object.maxAxisVelocity > 0 ? object.maxAxisVelocity : 0;
};

const baseHeights = (object: ControlledObjectConfig): [number, number] =>
  object.modelRunDirection === 2 ? [0, object.pulleyDistance] : [object.pulleyDistance, 0];

const maxHeightFor = (object: ControlledObjectConfig): number =>
  positive(
    motionParamsOfKind(
      CONTROL_TYPE_RULES[decodeControlType(object.controlType)].motionAxes,
      object.motionParams,
      "move",
    )?.maxAngle,
    positive(object.dimensions.h, 1),
  );

const twoPointLength = (object: ControlledObjectConfig): number => {
  const [first, second] = object.driveAxes;
  if (!first || !second) return positive(object.dimensions.w, 1);
  const start = mountOf(first);
  const end = mountOf(second);
  return positive(Math.hypot(start.x - end.x, start.z - end.z), positive(object.dimensions.w, 1));
};

const fourPointSpans = (object: ControlledObjectConfig): [number, number] => {
  const mounts = object.driveAxes.map(mountOf);
  if (mounts.length === 0) return [positive(object.dimensions.w, 1), positive(object.dimensions.d, 1)];
  const xs = mounts.map((mount) => mount.x);
  const zs = mounts.map((mount) => mount.z);
  return [
    positive(Math.max(...xs) - Math.min(...xs), positive(object.dimensions.w, 1)),
    positive(Math.max(...zs) - Math.min(...zs), positive(object.dimensions.d, 1)),
  ];
};

/** 把以 s 为原点（单位 100ms）的多项式平移到以 s+delta 为原点 */
const shiftPolynomial = (coefficients: Coefficients, delta: number): Coefficients =>
  coefficients.map((_, power) => {
    let sum = 0;
    for (let k = power; k < coefficients.length; k += 1) {
      sum += comb(k, power) * coefficients[k]! * delta ** (k - power);
    }
    return sum;
  }) as Coefficients;

const evaluate = (coefficients: Coefficients, u: number): number =>
  coefficients.reduceRight((sum, value) => sum * u + value, 0);

/** 与 compilePlcAction 下发的曲线行相同；每行持续到下一行或本段运动结束 */
const axisPieces = (
  resolved: ResolvedActionSequence,
  objectId: number,
  axis: VirtualAxisId,
): AxisPiece[] => {
  const segments = resolved.segments.filter((segment) => segment.objectId === objectId);
  const pieces: AxisPiece[] = [];
  for (const motion of objectAxisMotions(segments, axis)) {
    const rows = trapezoidToCurveSegments(
      motion.profile,
      motion.startMs,
      motion.from,
      motion.to,
      motion.durationMs,
      motion,
    );
    rows.forEach((row, index) => {
      const end = rows[index + 1]?.startTime ?? motion.endMs;
      if (end > row.startTime) {
        pieces.push({ start: row.startTime, end, coefficients: [row.a, row.b, row.c, row.d, row.e, row.f] });
      }
    });
  }
  return pieces.sort((left, right) => left.start - right.start);
};

/** 某轴在 [t0, …) 上的多项式：落在曲线行内就平移，否则保持最近一行的末值 */
const axisCoefficientsAt = (pieces: readonly AxisPiece[], t0: number, constant: number): Coefficients => {
  const hold = (value: number): Coefficients => [value, 0, 0, 0, 0, 0];
  if (pieces.length === 0) return hold(constant);
  const covering = pieces.find((piece) => piece.start <= t0 && t0 < piece.end);
  if (covering) return shiftPolynomial(covering.coefficients, (t0 - covering.start) / TICK_MS);
  const before = [...pieces].reverse().find((piece) => piece.end <= t0);
  if (before) return hold(evaluate(before.coefficients, (before.end - before.start) / TICK_MS));
  return hold(pieces[0]!.coefficients[0]);
};

const isConstantAxis = (segments: readonly ActionSegment[], axis: number): boolean => {
  const pieces = segments.flatMap((segment) => segment.coefficient_segments ?? []);
  const fixed = pieces[0]?.a[axis] ?? 0;
  return pieces.every((piece) => {
    const uEnd = (piece.end_frame - piece.start_frame) / TICK_MS;
    let variation = Math.abs(piece.a[axis]! - fixed);
    COEFFICIENT_NAMES.slice(1).forEach((name, offset) => {
      variation += Math.abs(piece[name][axis]!) * uEnd ** (offset + 1);
    });
    return variation <= CONSTANT_EPSILON;
  });
};

export type AlgorithmModelSource = {
  resolved: ResolvedActionSequence;
  objects: readonly ControlledObjectConfig[];
  motors: readonly MotorConfig[];
  telemetryByObjectId: ReadonlyMap<number, HpyPose>;
};

export type AlgorithmModelSet = {
  models: AlgorithmModel[];
  runtime: RuntimeModelState[];
};

/**
 * 序列里每个有受控轴的物体一个模型；model_id、device_id 都是物体 id。
 * 没有启用轴、或序列一个轴都不控制的物体不参与（它不动，也不需要准备）。
 * 实时状态没有速度反馈，按已停稳处理：只有停下来的推子才能准备。
 */
export const buildAlgorithmModels = (source: AlgorithmModelSource): AlgorithmModelSet => {
  const { resolved, objects, motors, telemetryByObjectId } = source;
  const models: AlgorithmModel[] = [];
  const runtime: RuntimeModelState[] = [];
  const objectIds = [...resolved.posesByObject.keys()].sort((left, right) => left - right);
  const sequenceStartMs = Math.min(
    ...[...resolved.posesByObject.values()].map((poses) => poses[0]?.atMs ?? Number.POSITIVE_INFINITY),
  );
  for (const objectId of objectIds) {
    const poses = resolved.posesByObject.get(objectId) ?? [];
    const first = poses[0];
    if (!first) continue;
    const object = objects.find((item) => item.id === objectId);
    if (!object) throw new Error(`缺少受控物体 ${objectId}`);
    const uncontrolled = uncontrolledAxesOf(resolved, objectId);
    const controlled = AXES.filter(
      (axis) => object.enabledVirtualAxes.includes(axis) && !uncontrolled.includes(axis),
    );
    if (controlled.length === 0) continue;

    const live = telemetryByObjectId.get(objectId) ?? { h: 0, p: 0, y: 0 };
    const current: Hpy = [live.h, live.p, live.y];
    const piecesByAxis = AXES.map((axis) =>
      controlled.includes(axis) ? axisPieces(resolved, objectId, axis) : [],
    );
    // 不受控、未启用的轴固定在实时位置；受控却没有运动段的轴停在首个位姿
    const constants = AXES.map((axis, index) =>
      controlled.includes(axis) ? first.pose[axis] : current[index]!,
    );

    // 原动作段（关键帧）按整毫秒划分，与 PLC 曲线的 uint32 起始时间一致；
    // 行进波浪等预设的位姿时间可能带小数，曲线本身仍按精确时间分段
    let startMs = Math.floor(first.atMs);
    let endMs = Math.ceil(resolved.totalMs);
    if (!(endMs > startMs)) {
      // 唯一的位姿就在序列末尾：从整条序列的第一帧起保持；整条序列只有这一刻时向后补 1ms
      startMs = Math.min(Math.floor(sequenceStartMs), endMs);
      if (!(endMs > startMs)) endMs = startMs + 1;
    }
    const keyframes = [
      ...new Set([startMs, ...poses.map((pose) => Math.round(pose.atMs)), endMs]),
    ]
      .filter((frame) => frame >= startMs && frame <= endMs)
      .sort((left, right) => left - right);
    const breakpoints = new Set(keyframes);
    for (const pieces of piecesByAxis) {
      for (const piece of pieces) {
        for (const frame of [piece.start, piece.end]) {
          if (frame > startMs && frame < endMs) breakpoints.add(frame);
        }
      }
    }
    const frames = [...breakpoints].sort((left, right) => left - right);
    const coefficientPieces: CoefficientPiece[] = [];
    for (let index = 0; index + 1 < frames.length; index += 1) {
      const t0 = frames[index]!;
      const t1 = frames[index + 1]!;
      const perAxis = piecesByAxis.map((pieces, axis) =>
        axisCoefficientsAt(pieces, t0, constants[axis]!),
      );
      const piece = { start_frame: t0, end_frame: t1 } as CoefficientPiece;
      COEFFICIENT_NAMES.forEach((name: CoefficientName, power) => {
        piece[name] = perAxis.map((coefficients) => coefficients[power]!) as Hpy;
      });
      coefficientPieces.push(piece);
    }
    const segments: ActionSegment[] = [];
    for (let index = 0; index + 1 < keyframes.length; index += 1) {
      const segmentStart = keyframes[index]!;
      const segmentEnd = keyframes[index + 1]!;
      segments.push({
        segment_id: index,
        start_frame: segmentStart,
        end_frame: segmentEnd,
        coefficient_segments: coefficientPieces.filter(
          (piece) => piece.start_frame >= segmentStart && piece.end_frame <= segmentEnd,
        ),
      });
    }

    // follow：曲线在变的受控轴；prepare 再加上固定值与实时位置不一致的受控轴
    const moving = controlled.filter((axis) => !isConstantAxis(segments, AXES.indexOf(axis)));
    const followAxes = moving.length > 0 ? moving : controlled;
    const prepareAxes = controlled.filter(
      (axis) =>
        followAxes.includes(axis) ||
        Math.abs(constants[AXES.indexOf(axis)]! - current[AXES.indexOf(axis)]!) > PREPARE_EPSILON,
    );
    const follow = followAxes.map((axis) => AXIS_NAME[axis]);
    const prepare = prepareAxes.map((axis) => AXIS_NAME[axis]);

    const maxMotorVelocity = maxMotorVelocityFor(object, motors);
    if (!(maxMotorVelocity > 0)) throw new Error(`模型${objectId}的最大电机速度必须大于0`);
    const max = AXES.map((axis) => maxVadFor(object, motors, axis));
    const defaults = AXES.map((axis, index) => defaultVadFor(object, axis, max[index]!));
    const column = (rows: Array<[number, number, number]>, field: number): Hpy =>
      rows.map((row) => row[field]!) as Hpy;
    const modelType = businessModelType(object);
    const model: AlgorithmModel = {
      plc_id: "1",
      model_id: objectId,
      device_id: objectId,
      model_type: modelType,
      motor_num: motorCountOf(modelType, object),
      active_axes: follow,
      follow_axes: follow,
      prepare_axes: prepare,
      max_motor_velocity: maxMotorVelocity,
      max_velocity_HPY: column(max, 0),
      max_acceleration_HPY: column(max, 1),
      max_deceleration_HPY: column(max, 2),
      default_velocity_HPY: column(defaults, 0),
      default_acceleration_HPY: column(defaults, 1),
      default_deceleration_HPY: column(defaults, 2),
      segments,
    };
    const [base1, base2] = baseHeights(object);
    if (modelType === 6 || modelType === 7) {
      model.BaseHight1 = base1;
      model.BaseHight2 = base2;
      model.maxheight = maxHeightFor(object);
      if (modelType === 6) {
        model.lLenth_inside = twoPointLength(object);
      } else {
        const [length, width] = fourPointSpans(object);
        model.lLenth_inside = length;
        model.wLenth_inside = width;
        // 四点正解只支持一个倾斜方向：Y 在动就用 Y，否则用 P
        model.moveWhat = follow.includes("Y") ? 2 : follow.includes("P") ? 1 : prepare.includes("Y") ? 2 : 1;
      }
    } else if (modelType === 8) {
      model.Baseheight1 = base1;
      model.Baseheight2 = base2;
      model.maxheight = maxHeightFor(object);
      model.point_init_pos = object.driveAxes.map((axis) => {
        const mount = mountOf(axis);
        return [mount.x, mount.z, 0];
      });
      model.betainit = object.initialTiltDirection ?? 0;
    }
    models.push(model);
    runtime.push({
      model_id: objectId,
      plc_id: "1",
      device_id: objectId,
      position_HPY: current,
      velocity_HPY: [0, 0, 0],
      standstill: true,
    });
  }
  return { models, runtime };
};
