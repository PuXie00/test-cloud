import {
  COEFFICIENT_NAMES,
  type ActionSegment,
  type AlgorithmModel,
  type CoefficientPiece,
  type Hpy,
  type RangeParameters,
} from "./algorithm-params";
import {
  motorInstantaneousSpeedOf,
  motorSpeedUpperOf,
  prepareEntryGeometry,
  type MotorGeometry,
} from "./nonforced-motor";
import {
  BinaryHeap,
  comb,
  fsum,
  interval as I,
  nextUp,
  SpeedInterval,
} from "./speed-interval";

/**
 * 逐项移植 python/调速范围计算/调速范围计算.py（2026-11-20 五模型版）的 calculate_range_result：
 * 模型 2 单点、3 多级升降、4 无极旋转、7 普通多点摆、9 XY多点摆。非强制先按单点 / 同步非单点 / 不同步分类，
 * 再取 虚轴 max_velocity_HPY ÷ 原曲线峰速、√(虚轴最大加/减速度 ÷ 原曲线双向加减速峰值)、
 * 实轴限速 ÷ 正解电机峰速 的最小值。max_factor 相对原动作，1 = 100%；unlimited 时无有限上限。
 * 多点 / XY 的正解速度与非强制就近共用（nonforced-motor.ts，两份 Python 的这几个函数相同）。
 * 不做 action_signature：范围每次现算，不缓存。
 */

export const RANGE_RESULT_VERSION = "shared_json_v2";

export type SpeedRangeResult = {
  max_factor: number | null;
  unlimited: boolean;
  action_category: string;
  range_version: string;
};

type Piece = Pick<CoefficientPiece, "start_frame" | "end_frame"> & Partial<Pick<CoefficientPiece, (typeof COEFFICIENT_NAMES)[number]>>;
type SegmentLike = ActionSegment | CoefficientPiece;

const SUPPORTED_MODEL_TYPES: Record<number, string> = {
  2: "单点",
  3: "多级升降",
  4: "无极旋转",
  7: "多点摆",
  9: "XY多点摆",
};

const unsupportedModelType = (kind: unknown): Error =>
  new Error(`不支持的模型类型：${String(kind)}，目前只支持2、3、4、7、9`);

/** 单虚轴直接映射：实轴峰速就是 H 峰速，非强制也不比较虚轴同步 */
const isSingleAxisModel = (kind: number): boolean => kind === 2 || kind === 3 || kind === 4;

const HPY_NAMES = "HPY";

const piecesOf = (segment: SegmentLike): Piece[] =>
  "coefficient_segments" in segment && segment.coefficient_segments !== undefined
    ? segment.coefficient_segments
    : [segment];

const coefficientOf = (piece: Piece, name: (typeof COEFFICIENT_NAMES)[number], axis: number): number =>
  Number(piece[name]?.[axis]);

/** 多项式（常数项在前）在 x 处的值，按 math.fsum 求和 */
const polynomialAt = (coefficients: readonly number[], x: number): number =>
  fsum(coefficients.map((value, index) => value * x ** index));

/** calculate_virtual_state：原动作绝对时间的位置与每秒速度 */
export const calculateVirtualState = (
  segment: SegmentLike | Piece,
  timeMs: number,
  unitMs: number,
): { positions: Hpy; velocities: Hpy } => {
  const startMs = Number(segment.start_frame);
  const endMs = Number(segment.end_frame);
  if (![startMs, endMs, timeMs, unitMs].every(Number.isFinite)) {
    throw new Error("动作帧、当前时间和系数时间单位必须是有限数值");
  }
  if (unitMs <= 0 || endMs <= startMs) throw new Error("系数时间单位必须大于 0，结束帧必须大于开始帧");
  if (!(startMs <= timeMs && timeMs <= endMs)) {
    throw new Error("当前时间必须位于该动作段的开始帧和结束帧之间");
  }
  if ("coefficient_segments" in segment && segment.coefficient_segments !== undefined) {
    const pieces = segment.coefficient_segments;
    if (!Array.isArray(pieces) || pieces.length === 0) throw new Error("coefficient_segments 必须是非空阶段列表");
    let previousEnd = startMs;
    let selected: Piece | null = null;
    pieces.forEach((piece, index) => {
      const pieceStart = Number(piece.start_frame);
      const pieceEnd = Number(piece.end_frame);
      if (![pieceStart, pieceEnd].every(Number.isFinite) || pieceEnd <= pieceStart) {
        throw new Error("系数阶段起止时间必须有限且结束晚于开始");
      }
      if (pieceStart !== previousEnd || pieceEnd > endMs) {
        throw new Error("系数阶段必须连续且完整地覆盖动作段，不能有间隔、重叠或越界");
      }
      if ((pieceStart <= timeMs && timeMs < pieceEnd) || (index === pieces.length - 1 && timeMs === pieceEnd)) {
        selected = piece;
      }
      previousEnd = pieceEnd;
    });
    if (previousEnd !== endMs || selected === null) throw new Error("系数阶段未完整覆盖动作段或当前时刻");
    return calculateVirtualState(selected, timeMs, unitMs);
  }
  const coefficients = COEFFICIENT_NAMES.map((name) => {
    const values = (segment as Piece)[name];
    if (!Array.isArray(values) || values.length !== 3) throw new Error(`系数 ${name} 必须包含 H/P/Y 三个数值`);
    const numbers = values.map(Number);
    if (!numbers.every(Number.isFinite)) throw new Error(`系数 ${name} 必须是有限数值`);
    return numbers;
  });
  // u 是段内的多项式自变量；例如经过 2500ms、单位为 100ms，则 u=25
  const u = (timeMs - startMs) / unitMs;
  const perSecond = 1000 / unitMs;
  const positions: Hpy = [0, 0, 0];
  const velocities: Hpy = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    const [a, b, c, d, e, f] = coefficients.map((values) => values[axis]!) as [number, number, number, number, number, number];
    positions[axis] = a + b * u + c * u ** 2 + d * u ** 3 + e * u ** 4 + f * u ** 5;
    velocities[axis] = (b + 2 * c * u + 3 * d * u ** 2 + 4 * e * u ** 3 + 5 * f * u ** 4) * perSecond;
  }
  return { positions, velocities };
};

/** find_unit_interval_roots：多项式（常数项在前）在 [0,1] 内的实根 */
export const findUnitIntervalRoots = (input: readonly number[]): number[] => {
  let coefficients = [...input];
  if (!coefficients.every(Number.isFinite)) throw new Error("求极值的系数必须是有限数值");
  while (coefficients.length > 0 && coefficients[coefficients.length - 1] === 0) coefficients.pop();
  if (coefficients.length <= 1) return [];
  const scale = Math.max(...coefficients.map(Math.abs));
  coefficients = coefficients.map((value) => value / scale);
  const derivative = coefficients.slice(1).map((value, index) => (index + 1) * value);
  const turningPoints = findUnitIntervalRoots(derivative);
  const boundaries = [...new Set([0, 1, ...turningPoints])].sort((left, right) => left - right);
  const evaluate = (x: number) => polynomialAt(coefficients, x);
  const values = boundaries.map(evaluate);
  // 包括切触 0 的重根；它不一定在两侧产生符号变化
  const roots = boundaries.filter((_, index) => Math.abs(values[index]!) <= 1e-12);
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    let left = boundaries[index]!;
    let right = boundaries[index + 1]!;
    let leftValue = values[index]!;
    const rightValue = values[index + 1]!;
    if (leftValue * rightValue >= 0) continue;
    for (let step = 0; step < 60; step += 1) {
      const middle = (left + right) / 2;
      const middleValue = evaluate(middle);
      if (middleValue === 0) {
        left = middle;
        right = middle;
        break;
      }
      if (leftValue < 0 === middleValue < 0) {
        left = middle;
        leftValue = middleValue;
      } else {
        right = middle;
      }
    }
    roots.push((left + right) / 2);
  }
  return [...new Set(roots)].sort((left, right) => left - right);
};

type Curves = SpeedInterval[][];

/** 多项式转 Bernstein 控制值；velocity=true 时先求导再乘每秒换算 */
const bernsteinControls = (
  piece: Piece,
  axis: number,
  velocity: boolean,
  duration: SpeedInterval,
  rate: SpeedInterval,
): SpeedInterval[] => {
  const raw = COEFFICIENT_NAMES.map((name) => coefficientOf(piece, name, axis));
  let coefficients = velocity
    ? [1, 2, 3, 4, 5].map((index) => I(raw[index]!).mul(index).mul(rate))
    : raw.map((value) => I(value));
  while (coefficients.length > 1 && coefficients[coefficients.length - 1]!.isZero()) {
    coefficients = coefficients.slice(0, -1);
  }
  let power = I(1);
  const scaled: SpeedInterval[] = [];
  for (const coefficient of coefficients) {
    scaled.push(coefficient.mul(power));
    power = power.mul(duration);
  }
  const degree = scaled.length - 1;
  const controls: SpeedInterval[] = [];
  for (let i = 0; i <= degree; i += 1) {
    let value = I(0);
    for (let k = 0; k <= i; k += 1) {
      value = value.add(scaled[k]!.mul(I(comb(i, k)).div(comb(degree, k))));
    }
    controls.push(value);
  }
  if (!controls.every((control) => Number.isFinite(control.lo) && Number.isFinite(control.hi))) {
    throw new Error("多点多项式区间溢出，请检查系数数值范围");
  }
  return controls;
};

/** de Casteljau 在中点二分 */
const splitControls = (controls: SpeedInterval[]): [SpeedInterval[], SpeedInterval[]] => {
  const left = [controls[0]!];
  const right = [controls[controls.length - 1]!];
  let row = controls;
  while (row.length > 1) {
    row = row.slice(0, -1).map((value, index) => value.add(row[index + 1]!).mul(0.5));
    left.push(row[0]!);
    right.push(row[row.length - 1]!);
  }
  return [left, right.reverse()];
};

const controlRange = (controls: SpeedInterval[]): SpeedInterval =>
  I(Math.min(...controls.map((control) => control.lo)), Math.max(...controls.map((control) => control.hi)));

/** 加速度为 0 的候选点：c..f 求导后的根，按段内比例 x∈[0,1] */
const accelerationRoots = (piece: Piece, axis: number, unitMs: number): number[] => {
  const uEnd = (Number(piece.end_frame) - Number(piece.start_frame)) / unitMs;
  const [c, d, e, f] = (["c", "d", "e", "f"] as const).map((name) => coefficientOf(piece, name, axis)) as [number, number, number, number];
  return findUnitIntervalRoots([2 * c, 6 * d * uEnd, 12 * e * uEnd * uEnd, 20 * f * uEnd * uEnd * uEnd]);
};

type HeapEntry = { negativeUpper: number; sequence: number; left: number; right: number; curves: Curves };

const heapOrder = (left: HeapEntry, right: HeapEntry): number =>
  left.negativeUpper - right.negativeUpper || left.sequence - right.sequence;

/**
 * calculate_multi_piece_max_velocity：多点 / XY 一个系数阶段的实轴峰速上界。
 * 按上界细分到相对 0.01% 或绝对 1e-9，最多 4096 次；预算用完仍保留上界。
 */
const multiPieceMaxVelocity = (piece: Piece, geometry: MotorGeometry, unitMs: number, xy: boolean): number => {
  const start = Number(piece.start_frame);
  const end = Number(piece.end_frame);
  calculateVirtualState(piece, start, unitMs);
  const duration = I(end).sub(start).div(unitMs);
  const rate = I(1000).div(unitMs);
  const curves: Curves = [false, true].flatMap((velocity) =>
    [0, 1, 2].map((axis) => bernsteinControls(piece, axis, velocity, duration, rate)),
  );
  const isZeroCurve = (curve: SpeedInterval[]) => curve.length === 1 && curve[0]!.isZero();
  if (curves.slice(3).every(isZeroCurve)) return 0;
  // P 恒为 0（XY 为 P、Y 都恒为 0）时正解只是 H 平移，Y 只改方向不改绳长
  const pureH = (xy ? [1, 2] : [1]).every((axis) => isZeroCurve(curves[axis]!));
  const bound = (current: Curves): number => {
    const values = current.map(controlRange);
    return pureH ? values[3]!.maxAbs() : motorSpeedUpperOf(values.slice(0, 3), values.slice(3), geometry, xy);
  };
  const instantaneous = (x: number): number => {
    const timeMs = x === 0 ? start : x === 1 ? end : start + x * (end - start);
    const { positions, velocities } = calculateVirtualState(piece, timeMs, unitMs);
    return pureH ? Math.abs(velocities[0]) : motorInstantaneousSpeedOf(positions, velocities, geometry, xy);
  };
  const candidates = new Set([0, 0.5, 1]);
  for (const axis of [0, 1, 2]) {
    for (const root of accelerationRoots(piece, axis, unitMs)) candidates.add(root);
  }
  let best = Math.max(...[...candidates].map(instantaneous));
  const heap = new BinaryHeap<HeapEntry>(heapOrder);
  heap.push({ negativeUpper: -Math.max(best, bound(curves)), sequence: 0, left: 0, right: 1, curves });
  let sequence = 0;
  let retired = best;
  for (let iteration = 0; iteration < 4096; iteration += 1) {
    const top = heap.peek();
    if (!top) return nextUp(Math.max(best, retired));
    const maximum = Math.max(best, retired, -top.negativeUpper);
    if (maximum - best <= Math.max(1e-9, best * 1e-4)) return nextUp(maximum);
    const entry = heap.pop()!;
    if (-entry.negativeUpper <= best) {
      retired = Math.max(retired, -entry.negativeUpper);
      continue;
    }
    const middle = (entry.left + entry.right) * 0.5;
    if (middle === entry.left || middle === entry.right) return nextUp(maximum);
    best = Math.max(best, instantaneous(middle));
    const halves = entry.curves.map(splitControls);
    const sides: Array<[number, number]> = [
      [entry.left, middle],
      [middle, entry.right],
    ];
    sides.forEach(([left, right], side) => {
      const child = halves.map((pair) => pair[side]!);
      const upper = bound(child);
      if (upper <= best) {
        retired = Math.max(retired, upper);
      } else {
        sequence += 1;
        heap.push({ negativeUpper: -upper, sequence, left, right, curves: child });
      }
    });
  }
  const top = heap.peek();
  return nextUp(Math.max(best, retired, top ? -top.negativeUpper : best));
};

/** 峰速复用键：几何、系数时间单位、各阶段时长及全部 abcdef；绝对开始帧不影响峰速 */
const segmentVelocityKey = (segment: SegmentLike, geometryKey: string, unitMs: number): string =>
  JSON.stringify([
    geometryKey,
    unitMs,
    piecesOf(segment).map((piece) => [
      Number(piece.end_frame) - Number(piece.start_frame),
      COEFFICIENT_NAMES.map((name) => (piece[name] ?? []).map(Number)),
    ]),
  ]);

/** _virtual_peak_velocities：各轴原曲线峰速；多点倾角、XY 两个角全程须在 (-90,90) 内 */
const virtualPeakVelocities = (model: AlgorithmModel, unitMs: number): Hpy => {
  const peaks: Hpy = [0, 0, 0];
  for (const segment of model.segments) {
    calculateVirtualState(segment, Number(segment.start_frame), unitMs);
    for (const piece of piecesOf(segment)) {
      const start = Number(piece.start_frame);
      const end = Number(piece.end_frame);
      const duration = (end - start) / unitMs;
      const first = calculateVirtualState(piece, start, unitMs).velocities;
      const last = calculateVirtualState(piece, end, unitMs).velocities;
      for (let axis = 0; axis < 3; axis += 1) {
        const [b, c, d, e, f] = (["b", "c", "d", "e", "f"] as const).map((name) => coefficientOf(piece, name, axis)) as [number, number, number, number, number];
        let peak = Math.max(Math.abs(first[axis]!), Math.abs(last[axis]!));
        const acceleration = [2 * c, 6 * d * duration, 12 * e * duration ** 2, 20 * f * duration ** 3];
        for (const fraction of findUnitIntervalRoots(acceleration)) {
          const { velocities } = calculateVirtualState(piece, start + fraction * (end - start), unitMs);
          peak = Math.max(peak, Math.abs(velocities[axis]!));
        }
        if (!Number.isFinite(peak)) throw new Error("原曲线峰速必须是有限数值");
        peaks[axis] = Math.max(peaks[axis]!, peak);
        const angleAxis = (model.model_type === 7 && axis === 1) || (model.model_type === 9 && (axis === 1 || axis === 2));
        if (angleAxis) {
          const velocityCoefficients = [b, 2 * c * duration, 3 * d * duration ** 2, 4 * e * duration ** 3, 5 * f * duration ** 4];
          const frames = [start, end, ...findUnitIntervalRoots(velocityCoefficients).map((x) => start + x * (end - start))];
          for (const frame of frames) {
            const { positions } = calculateVirtualState(piece, frame, unitMs);
            if (Math.abs(positions[axis]!) >= 90) {
              throw new Error(`模型${model.model_id ?? "?"}的${HPY_NAMES[axis]}倾角须在(-90,90)内`);
            }
          }
        }
      }
    }
  }
  return peaks;
};

/** _virtual_peak_accelerations：速度幅值增大（A）、减小（D）时的加速度峰值，单位每秒平方 */
const virtualPeakAccelerations = (model: AlgorithmModel, unitMs: number): [Hpy, Hpy] => {
  const accelerating: Hpy = [0, 0, 0];
  const decelerating: Hpy = [0, 0, 0];
  const rate = 1000 / unitMs;
  for (const segment of model.segments) {
    for (const piece of piecesOf(segment)) {
      const duration = (Number(piece.end_frame) - Number(piece.start_frame)) / unitMs;
      for (let axis = 0; axis < 3; axis += 1) {
        const [b, c, d, e, f] = (["b", "c", "d", "e", "f"] as const).map((name) => coefficientOf(piece, name, axis)) as [number, number, number, number, number];
        const velocity = [b, 2 * c * duration, 3 * d * duration ** 2, 4 * e * duration ** 3, 5 * f * duration ** 4];
        const acceleration = [2 * c, 6 * d * duration, 12 * e * duration ** 2, 20 * f * duration ** 3];
        // Python any()：非 0（含 NaN）为真
        if (!acceleration.some((value) => value !== 0)) continue;
        const jerk = acceleration.slice(1).map((value, index) => (index + 1) * value);
        const boundaries = [
          ...new Set([0, 1, ...findUnitIntervalRoots(velocity), ...findUnitIntervalRoots(acceleration)]),
        ].sort((left, right) => left - right);
        const extrema = findUnitIntervalRoots(jerk);
        for (let index = 0; index + 1 < boundaries.length; index += 1) {
          const left = boundaries[index]!;
          const right = boundaries[index + 1]!;
          const middle = (left + right) * 0.5;
          const middleV = polynomialAt(velocity, middle);
          const middleA = polynomialAt(acceleration, middle);
          if (middleV === 0 || middleA === 0) continue;
          const candidates = [left, right, ...extrema.filter((value) => left < value && value < right)];
          let peak = Math.max(...candidates.map((fraction) => Math.abs(polynomialAt(acceleration, fraction))));
          peak = peak * rate * rate;
          if (!Number.isFinite(peak)) throw new Error("原曲线加减速度峰值必须是有限数值");
          const result = middleV > 0 === middleA > 0 ? accelerating : decelerating;
          result[axis] = Math.max(result[axis]!, peak);
        }
      }
    }
  }
  return [accelerating, decelerating];
};

/** max_velocity_HPY / max_acceleration_HPY / max_deceleration_HPY：三个有限非负数 */
const hpyLimitsOf = (supplied: unknown, shapeMessage: string, valueMessage: string): Hpy => {
  if (!Array.isArray(supplied) || supplied.length !== 3) throw new Error(shapeMessage);
  if (supplied.some((value) => typeof value === "boolean")) throw new Error(valueMessage);
  const limits = supplied.map((value) =>
    typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN,
  ) as Hpy;
  if (limits.some((value) => !Number.isFinite(value) || value < 0)) throw new Error(valueMessage);
  return limits;
};

const CAPABILITY_FIELDS = ["max_acceleration_HPY", "max_deceleration_HPY"] as const;

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * _validate_rotation_curve：无极旋转是纯姿态，只有 H 有效，P/Y 不能有运动；
 * 软行程 [min, max] 宽度 ≥ workingStroke 时覆盖整圈（上限可以超过周期），曲线可以连续跨零（350→370）；
 * 部分软行程时每段的位置包络（端点和内部极值）须落在同一个 [min+k·P, max+k·P] 副本里，
 * 不能只把几个点取模再判断，否则会漏掉穿过禁用区的路径。
 */
const validateRotationCurve = (model: AlgorithmModel, unitMs: number): void => {
  const period = model.workingStroke;
  if (!isFiniteNumber(period) || period <= 0) throw new Error("无极旋转workingStroke须为真实有限正周期");
  const count = model.motor_num ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 32) {
    throw new Error("无极旋转motor_num须为1到32的整数，全部绑定轴须使用相同workingStroke");
  }
  const [lower, upper] = (["min_position_HPY", "max_position_HPY"] as const).map((name) => {
    const values: unknown = model[name];
    if (!Array.isArray(values) || values.length !== 3 || !values.every(isFiniteNumber)) {
      throw new Error(`无极旋转${name}须提供H/P/Y三个有限数值`);
    }
    return values[0] as number;
  }) as [number, number];
  if (!(0 <= lower && lower < upper)) {
    throw new Error("无极旋转H软行程须满足0<=min<max，workingStroke仍为真实正周期");
  }
  if (!model.segments || model.segments.length === 0) throw new Error("无极旋转至少需要一段动作");
  const tolerance = 1e-8;
  const fullPeriod = upper - lower >= period - tolerance;
  for (const segment of model.segments) {
    calculateVirtualState(segment, segment.start_frame, unitMs);
    for (const piece of piecesOf(segment)) {
      if ((["b", "c", "d", "e", "f"] as const).some((name) => [1, 2].some((axis) => coefficientOf(piece, name, axis) !== 0))) {
        throw new Error("无极旋转只支持H角度轴，P/Y不能包含运动");
      }
      // 区间覆盖整个姿态圆，不把宽度误当作真实周期
      if (fullPeriod) continue;
      const start = Number(piece.start_frame);
      const end = Number(piece.end_frame);
      const duration = (end - start) / unitMs;
      const velocity = (["b", "c", "d", "e", "f"] as const).map(
        (name, offset) => (offset + 1) * coefficientOf(piece, name, 0) * duration ** offset,
      );
      const frames = [start, end, ...findUnitIntervalRoots(velocity).map((x) => start + x * (end - start))];
      const positions = frames.map((frame) => calculateVirtualState(piece, frame, unitMs).positions[0]);
      if (!positions.every(Number.isFinite)) throw new Error("无极旋转原曲线位置必须为有限数值");
      const minimum = Math.min(...positions);
      const maximum = Math.max(...positions);
      const cycle = Math.floor((minimum - lower + tolerance) / period);
      if (minimum < lower + cycle * period - tolerance || maximum > upper + cycle * period + tolerance) {
        throw new Error("无极旋转原曲线越过允许姿态弧；部分范围不能跨过禁用区");
      }
    }
  }
};

/** calculate_velocity_adjust：分类、虚轴限速、已提供的虚轴加减速度、实轴限速共同允许的倍率 */
const calculateVelocityAdjust = (
  models: readonly AlgorithmModel[],
  unitMs: number,
  classificationMaxFactor: number,
): number => {
  let allowed = classificationMaxFactor;
  // 只在本次计算中复用相同动作段的峰速
  const segmentCache = new Map<string, number>();
  for (const model of models) {
    const kind = model.model_type;
    if (!(kind in SUPPORTED_MODEL_TYPES)) throw unsupportedModelType(kind);
    const label = `模型${model.model_id ?? "?"}`;
    if (kind === 4) validateRotationCurve(model, unitMs);
    const velocityLimits = hpyLimitsOf(
      model.max_velocity_HPY,
      `${label}需要H/P/Y三个max_velocity_HPY最大速度`,
      `${label}的max_velocity_HPY须为三个有限非负数`,
    );
    const peaks = virtualPeakVelocities(model, unitMs);
    peaks.forEach((peak, axis) => {
      if (!(peak > 0)) return;
      if (velocityLimits[axis] === 0) throw new Error(`${label}的${HPY_NAMES[axis]}最大速度为0，但原曲线包含运动`);
      allowed = Math.min(allowed, velocityLimits[axis]! / peak);
    });
    if (CAPABILITY_FIELDS.some((name) => model[name] !== undefined)) {
      // 此接口没有方向字段，时间反向时 A/D 互换，范围须同时覆盖两种方向
      const [accelerating, decelerating] = virtualPeakAccelerations(model, unitMs);
      const bothDirections = accelerating.map((value, axis) => Math.max(value, decelerating[axis]!));
      for (const name of CAPABILITY_FIELDS) {
        if (model[name] === undefined) continue;
        const limits = hpyLimitsOf(
          model[name],
          `${label}的${name}须提供H/P/Y三个真实能力`,
          `${label}的${name}须为三个有限非负数`,
        );
        bothDirections.forEach((peak, axis) => {
          if (!(peak > 0)) return;
          if (limits[axis] === 0) throw new Error(`${label}的${HPY_NAMES[axis]}轴${name}为0，但原曲线需要相应加减速`);
          allowed = Math.min(allowed, Math.sqrt(limits[axis]!) / Math.sqrt(peak));
        });
      }
    }
    const motorLimit = Number(model.max_motor_velocity);
    if (!Number.isFinite(motorLimit) || motorLimit <= 0) throw new Error(`${label}的max_motor_velocity须为有限正数`);
    let motorPeak: number;
    if (isSingleAxisModel(kind)) {
      motorPeak = peaks[0];
    } else {
      const points = model.point_init_pos;
      if (kind === 9 && Array.isArray(points) && model.motor_num !== undefined && model.motor_num !== points.length) {
        throw new Error("motor_num须与吊点数量一致");
      }
      const geometry = prepareEntryGeometry(model as unknown as Record<string, unknown>);
      const geometryKey = JSON.stringify([
        kind,
        geometry.points,
        geometry.base1,
        geometry.base2,
        geometry.maxHeight,
        geometry.beta,
      ]);
      motorPeak = 0;
      for (const segment of model.segments) {
        const key = segmentVelocityKey(segment, geometryKey, unitMs);
        let peak = segmentCache.get(key);
        if (peak === undefined) {
          peak = Math.max(...piecesOf(segment).map((piece) => multiPieceMaxVelocity(piece, geometry, unitMs, kind === 9)));
          segmentCache.set(key, peak);
        }
        motorPeak = Math.max(motorPeak, peak);
      }
    }
    if (motorPeak > 0) allowed = Math.min(allowed, motorLimit / motorPeak);
  }
  return allowed;
};

type AxisPhase = [name: string, startMs: number, endMs: number];

/** 非强制按单点 / 同步非单点 / 不同步分类；只要任意非单点模型有一段不同步，整个动作最高 100% */
const classifyNonForced = (
  models: readonly AlgorithmModel[],
  unitMs: number,
): { category: string; maxFactor: number } => {
  let allSinglePoint = true;
  let allNonSingleSynchronized = true;
  for (const model of models) {
    if (!(model.model_type in SUPPORTED_MODEL_TYPES)) throw unsupportedModelType(model.model_type);
    if (!model.segments || model.segments.length === 0) throw new Error("每个模型至少需要一段动作");
    // 单点、多级升降、无极旋转不需要比较多个虚轴的同步情况
    if (isSingleAxisModel(model.model_type)) continue;
    allSinglePoint = false;
    for (const segment of model.segments) {
      calculateVirtualState(segment, segment.start_frame, unitMs);
      const pieces = piecesOf(segment);
      const movingAxisPhases: Array<[AxisPhase[], boolean]> = [];
      let segmentSynchronized = true;
      for (let axis = 0; axis < 3; axis += 1) {
        const axisPhases: AxisPhase[] = [];
        let axisMoves = false;
        let trapezoidConfirmed = true;
        for (const piece of pieces) {
          const startVelocity = calculateVirtualState(piece, Number(piece.start_frame), unitMs).velocities[axis]!;
          const endVelocity = calculateVirtualState(piece, Number(piece.end_frame), unitMs).velocities[axis]!;
          // 只在同步分类时消除零速残差，不修改原轨迹
          const tolerance = 1e-12 * Math.max(Math.abs(startVelocity), Math.abs(endVelocity));
          const phaseStartVelocity = Math.abs(startVelocity) <= tolerance ? 0 : startVelocity;
          const phaseEndVelocity = Math.abs(endVelocity) <= tolerance ? 0 : endVelocity;
          const startMs = Number(piece.start_frame);
          const endMs = Number(piece.end_frame);
          const stationary = (["b", "c", "d", "e", "f"] as const).every((name) => coefficientOf(piece, name, axis) === 0);
          let phaseName: string;
          if (stationary) {
            phaseName = "静止";
          } else {
            axisMoves = true;
            if ((["d", "e", "f"] as const).some((name) => coefficientOf(piece, name, axis) !== 0)) {
              trapezoidConfirmed = false;
              phaseName = "未确认";
            } else if (coefficientOf(piece, "c", axis) === 0) {
              phaseName = "匀速";
            } else if (
              (phaseStartVelocity < 0 && 0 < phaseEndVelocity) ||
              (phaseEndVelocity < 0 && 0 < phaseStartVelocity)
            ) {
              trapezoidConfirmed = false;
              phaseName = "未确认";
            } else if (Math.abs(phaseEndVelocity) > Math.abs(phaseStartVelocity)) {
              phaseName = "加速";
            } else {
              phaseName = "减速";
            }
          }
          // 同一阶段可能被拆成几组系数，合并后再比较实际起止时间
          const previous = axisPhases[axisPhases.length - 1];
          if (previous && previous[0] === phaseName) previous[2] = endMs;
          else axisPhases.push([phaseName, startMs, endMs]);
        }
        if (axisMoves) movingAxisPhases.push([axisPhases, trapezoidConfirmed]);
      }
      // 只有一个虚轴运动时，没有多个运动虚轴之间的不同步问题
      if (movingAxisPhases.length > 1) {
        const reference = movingAxisPhases[0]![0];
        for (const [axisPhases, confirmed] of movingAxisPhases) {
          if (!confirmed || axisPhases.length !== reference.length) {
            segmentSynchronized = false;
            break;
          }
          const mismatch = axisPhases.some(
            (actual, index) =>
              actual[0] !== reference[index]![0] ||
              Math.abs(actual[1] - reference[index]![1]) > 1e-6 ||
              Math.abs(actual[2] - reference[index]![2]) > 1e-6,
          );
          if (mismatch) {
            segmentSynchronized = false;
            break;
          }
        }
      }
      if (!segmentSynchronized) allNonSingleSynchronized = false;
    }
  }
  if (allSinglePoint) {
    const category = models.some((model) => model.model_type === 4)
      ? "全部单点/多级升降/无极旋转：可升速、可降速"
      : "全部单点/多级升降：可升速、可降速";
    return { category, maxFactor: Number.POSITIVE_INFINITY };
  }
  if (allNonSingleSynchronized) {
    return { category: "同步非单点：可升速、可降速", maxFactor: Number.POSITIVE_INFINITY };
  }
  return { category: "不同步或未确认同步的非单点：只能降速，最高100%", maxFactor: 1 };
};

/** calculate_range_result：失败抛错，调用方不得沿用旧结果 */
export const calculateRangeResult = (parameters: RangeParameters): SpeedRangeResult => {
  const trajectoryRun = parameters.command?.trajectory_run;
  if (typeof trajectoryRun !== "boolean") throw new Error("trajectory_run必须是true或false");
  const models = parameters.models;
  if (!Array.isArray(models) || models.length === 0) throw new Error("models 不能为空，至少需要一个模型");
  // 两种运行方式共用系数时间单位
  const unitMs = Number(parameters.settings?.forced_coefficient_time_unit_ms);
  if (!Number.isFinite(unitMs) || unitMs <= 0) throw new Error("系数时间单位必须是有限的正数");
  let category = "强制轨迹：按原始曲线计算";
  let classificationMaxFactor = Number.POSITIVE_INFINITY;
  if (!trajectoryRun) {
    const classified = classifyNonForced(models, unitMs);
    category = classified.category;
    classificationMaxFactor = classified.maxFactor;
  }
  const velocityAdjust = calculateVelocityAdjust(models, unitMs, classificationMaxFactor);
  if (Number.isNaN(velocityAdjust) || velocityAdjust <= 0) {
    throw new Error("最大调速倍率必须大于0，请检查原动作和电机限速");
  }
  const unlimited = velocityAdjust === Number.POSITIVE_INFINITY;
  return {
    max_factor: unlimited ? null : velocityAdjust,
    unlimited,
    action_category: category,
    range_version: RANGE_RESULT_VERSION,
  };
};
