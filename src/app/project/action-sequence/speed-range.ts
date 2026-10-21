import {
  COEFFICIENT_NAMES,
  type ActionSegment,
  type AlgorithmModel,
  type CoefficientPiece,
  type Hpy,
  type RangeParameters,
} from "./algorithm-params";
import {
  BinaryHeap,
  comb,
  fsum,
  interval as I,
  nextDown,
  nextUp,
  SpeedInterval,
} from "./speed-interval";

/**
 * 逐项移植 python/调速范围计算/调速范围计算.py 的 calculate_range_result：
 * 非强制先按单点 / 同步非单点 / 不同步分类，再取各模型 本模型实轴限速 ÷ 原动作峰速 的最小值。
 * max_factor 相对原动作，1 = 100%；unlimited 时无有限上限。不做 action_signature。
 */

export const RANGE_RESULT_VERSION = "shared_json_v1";

export type SpeedRangeResult = {
  max_factor: number | null;
  unlimited: boolean;
  action_category: string;
  range_version: string;
};

type Piece = Pick<CoefficientPiece, "start_frame" | "end_frame"> & Partial<Pick<CoefficientPiece, (typeof COEFFICIENT_NAMES)[number]>>;
type SegmentLike = ActionSegment | CoefficientPiece;

const DEG_TO_RAD = Math.PI / 180;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const piecesOf = (segment: SegmentLike): Piece[] =>
  "coefficient_segments" in segment && segment.coefficient_segments !== undefined
    ? segment.coefficient_segments
    : [segment];

const coefficientOf = (piece: Piece, name: (typeof COEFFICIENT_NAMES)[number], axis: number): number =>
  Number(piece[name]?.[axis]);

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
  const evaluate = (x: number) => fsum(coefficients.map((value, index) => value * x ** index));
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

/** liangdian_velocity_model：两个电机的带符号瞬时速度 */
export const twoPointVelocityModel = (
  height: number,
  argXInput: number,
  velocityH: number,
  velocityXInput: number,
  baseHeight1: number,
  baseHeight2: number,
  lengthInside: number,
  maxHeight: number,
): [number, number] => {
  const values = [height, argXInput, velocityH, velocityXInput, baseHeight1, baseHeight2, lengthInside, maxHeight];
  if (!values.every(Number.isFinite)) throw new Error("两点位置、速度和几何参数必须是有限数值");
  let argX = argXInput;
  let velocityX = velocityXInput;
  let originHeight: number;
  let pointHeight: number;
  let distanceSign: number;
  if (baseHeight1 !== 0 && baseHeight2 === 0) {
    originHeight = 0;
    pointHeight = height + baseHeight1;
    distanceSign = 1;
  } else if (baseHeight1 === 0 && baseHeight2 !== 0) {
    // 原位置正解将角度取反，角速度也同时取反
    argX = -argX;
    velocityX = -velocityX;
    originHeight = baseHeight2 + maxHeight;
    pointHeight = height;
    distanceSign = -1;
  } else {
    throw new Error("两点正解要求BaseHight1和BaseHight2恰好一个为0，另一个非0");
  }
  const halfLength = lengthInside / 2;
  const angleRad = argX * DEG_TO_RAD;
  const angularVelocityRad = velocityX * DEG_TO_RAD;
  const sinAngle = Math.sin(angleRad);
  const cosAngle = Math.cos(angleRad);
  const offset = (argX / 90) ** 3 * halfLength;
  const offsetVelocity = 3 * (argX / 90) ** 2 * (velocityX / 90) * halfLength;
  const dxA = halfLength * (1 - cosAngle) - offset;
  const dxB = halfLength * (cosAngle - 1) - offset;
  const dyA = pointHeight - halfLength * sinAngle - originHeight;
  const dyB = pointHeight + halfLength * sinAngle - originHeight;
  const dxVelocityA = halfLength * sinAngle * angularVelocityRad - offsetVelocity;
  const dxVelocityB = -halfLength * sinAngle * angularVelocityRad - offsetVelocity;
  const dyVelocityA = velocityH - halfLength * cosAngle * angularVelocityRad;
  const dyVelocityB = velocityH + halfLength * cosAngle * angularVelocityRad;
  const motor = (name: string, dx: number, dy: number, dxVelocity: number, dyVelocity: number): number => {
    const distance = Math.hypot(dx, dy);
    if (distance === 0) {
      if (dxVelocity !== 0 || dyVelocity !== 0) {
        throw new Error(`两点电机${name}相对原点的距离为0，此时位置正解不可求导`);
      }
      return 0;
    }
    return distanceSign * ((dx / distance) * dxVelocity + (dy / distance) * dyVelocity);
  };
  return [motor("A", dxA, dyA, dxVelocityA, dyVelocityA), motor("B", dxB, dyB, dxVelocityB, dyVelocityB)];
};

/** sidian_velocity_model：四个电机的带符号瞬时速度，电机顺序与四点正解一致 */
export const fourPointVelocityModel = (
  height: number,
  argXDeg: number,
  argYDeg: number,
  velocityH: number,
  velocityX: number,
  velocityY: number,
  baseHeight1: number,
  baseHeight2: number,
  lengthInside: number,
  widthInside: number,
  maxHeight: number,
  moveWhat: unknown,
): number[] => {
  const values = [
    height, argXDeg, argYDeg, velocityH, velocityX, velocityY,
    baseHeight1, baseHeight2, lengthInside, widthInside, maxHeight,
  ];
  if (!values.every(Number.isFinite)) throw new Error("四点位置、速度和几何参数必须是有限数值");
  if (!((baseHeight1 !== 0 && baseHeight2 === 0) || (baseHeight1 === 0 && baseHeight2 !== 0))) {
    throw new Error("四点正解要求BaseHight1和BaseHight2恰好一个为0，另一个非0");
  }
  if (moveWhat === 1) {
    const [a, b] = twoPointVelocityModel(height, argXDeg, velocityH, velocityX, baseHeight1, baseHeight2, lengthInside, maxHeight);
    return [a, b, b, a];
  }
  if (moveWhat === 2) {
    const [a, b] = twoPointVelocityModel(height, argYDeg, velocityH, velocityY, baseHeight1, baseHeight2, widthInside, maxHeight);
    return [b, b, a, a];
  }
  return [velocityH, velocityH, velocityH, velocityH];
};

/** 包围 component/hypot(component,other)，保留分子分母的几何关联 */
const motorDirectionInterval = (component: SpeedInterval, other: SpeedInterval): SpeedInterval => {
  const minimumOther = other.lo <= 0 && 0 <= other.hi ? 0 : Math.min(Math.abs(other.lo), Math.abs(other.hi));
  const maximumOther = Math.max(Math.abs(other.lo), Math.abs(other.hi));
  const corner = (value: number, perpendicular: number, lower: boolean): number => {
    if (value === 0 && perpendicular === 0) return lower ? -1 : 1;
    // 先归一化再平方，防止很大/很小的有效几何尺寸溢出或下溢
    const scale = Math.max(Math.abs(value), Math.abs(perpendicular));
    const numerator = I(value).div(scale);
    const denominatorComponent = I(perpendicular).div(scale);
    const distance = numerator.square().add(denominatorComponent.square()).sqrt();
    if (distance.lo === 0) return lower ? -1 : 1;
    const ratio = numerator.div(distance);
    return lower ? Math.max(-1, ratio.lo) : Math.min(1, ratio.hi);
  };
  const lowOther = component.lo >= 0 ? maximumOther : minimumOther;
  const highOther = component.hi <= 0 ? maximumOther : minimumOther;
  return I(corner(component.lo, lowOther, true), corner(component.hi, highOther, false));
};

/** 用两点求导公式包围两个实轴的绝对速度；四点按方向复用 */
const twoPointMotorSpeedUpper = (
  height: SpeedInterval,
  angleInput: SpeedInterval,
  velocityH: SpeedInterval,
  velocityAngleInput: SpeedInterval,
  baseHeight1: number,
  baseHeight2: number,
  halfLength: number,
  maxHeight: number,
): number => {
  let angle = angleInput;
  let velocityAngle = velocityAngleInput;
  let relativeHeight: SpeedInterval;
  if (baseHeight1 !== 0 && baseHeight2 === 0) {
    relativeHeight = height.add(baseHeight1);
  } else {
    angle = angle.neg();
    velocityAngle = velocityAngle.neg();
    relativeHeight = height.sub(I(baseHeight2).add(maxHeight));
  }
  const radians = angle.mul(I(Math.PI).div(180));
  const angularVelocity = velocityAngle.mul(I(Math.PI).div(180));
  const sine = radians.trig();
  const cosine = radians.trig(true);
  const normalizedAngle = angle.div(90);
  const offset = normalizedAngle.square().mul(normalizedAngle).mul(halfLength);
  const offsetVelocity = normalizedAngle.square().mul(velocityAngle.div(90)).mul(3 * halfLength);
  const span = I(1).sub(cosine).mul(halfLength);
  const rotationVelocity = sine.mul(angularVelocity).mul(halfLength);
  const verticalVelocity = cosine.mul(angularVelocity).mul(halfLength);
  let upper = 0;
  for (const side of [1, -1]) {
    const dx = span.mul(side).sub(offset);
    const dy = relativeHeight.sub(sine.mul(side * halfLength));
    const vx = rotationVelocity.mul(side).sub(offsetVelocity);
    const vy = velocityH.sub(verticalVelocity.mul(side));
    const projected = motorDirectionInterval(dx, dy).mul(vx).add(motorDirectionInterval(dy, dx).mul(vy));
    // 单位方向投影也不超过相对速度向量的长度；原点奇异时此界仍有限
    let normUpper = Math.hypot(vx.maxAbs(), vy.maxAbs());
    for (let index = 0; index < 4; index += 1) normUpper = nextUp(normUpper);
    if (![projected.lo, projected.hi, normUpper].every(Number.isFinite)) {
      throw new Error("两点/四点区间计算溢出，请检查几何参数和系数的数值范围");
    }
    upper = Math.max(upper, Math.min(projected.maxAbs(), normUpper));
  }
  return nextUp(upper);
};

type Curves = SpeedInterval[][];

/** 多项式转 Bernstein 控制值；velocity=true 时先求导再乘每秒换算 */
const bernsteinControls = (
  piece: Piece,
  axis: number,
  velocity: boolean,
  duration: SpeedInterval,
  rate: SpeedInterval,
  overflowMessage: string,
  multiPoint: boolean,
): SpeedInterval[] => {
  const raw = COEFFICIENT_NAMES.map((name) => coefficientOf(piece, name, axis));
  if (!multiPoint && !raw.every(Number.isFinite)) throw new Error("位置系数必须是有限数值");
  let coefficients: SpeedInterval[];
  if (velocity) {
    coefficients = [1, 2, 3, 4, 5].map((index) =>
      multiPoint ? I(raw[index]!).mul(index).mul(rate) : I(index).mul(raw[index]!).mul(rate),
    );
  } else {
    coefficients = raw.map((value) => I(value));
  }
  while (coefficients.length > 1 && coefficients[coefficients.length - 1]!.isZero()) coefficients.pop();
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
    throw new Error(overflowMessage);
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

/** calculate_two_four_piece_max_velocity：一个系数阶段两点/四点峰速的数值上界 */
const twoFourPieceMaxVelocity = (piece: Piece, model: AlgorithmModel, unitMs: number): number => {
  const startMs = Number(piece.start_frame);
  const endMs = Number(piece.end_frame);
  const initial = calculateVirtualState(piece, startMs, unitMs);
  const base1 = Number(model.BaseHight1);
  const base2 = Number(model.BaseHight2);
  const maxHeight = Number(model.maxheight);
  if (![base1, base2, maxHeight].every(Number.isFinite)) throw new Error("两点/四点几何参数必须是有限数值");
  if (!((base1 !== 0 && base2 === 0) || (base1 === 0 && base2 !== 0))) {
    throw new Error("两点/四点正解要求上下原点恰好一个非0");
  }
  let angleAxis: 1 | 2 | null;
  let length: number;
  if (model.model_type === 6 || model.moveWhat === 1) {
    angleAxis = 1;
    length = Number(model.lLenth_inside);
  } else if (model.moveWhat === 2) {
    angleAxis = 2;
    length = Number(model.wLenth_inside);
  } else {
    angleAxis = null;
    length = 0;
  }
  if (!Number.isFinite(length)) throw new Error("两点/四点吊点间距必须是有限数值");
  const motorVelocities = (q: Hpy, v: Hpy): number[] =>
    model.model_type === 6
      ? twoPointVelocityModel(q[0], q[1], v[0], v[1], base1, base2, length, maxHeight)
      : fourPointVelocityModel(
          q[0], q[1], q[2], v[0], v[1], v[2], base1, base2,
          Number(model.lLenth_inside), Number(model.wLenth_inside), maxHeight, model.moveWhat,
        );
  // 沿用原速度函数的输入验证，四点未选中方向的几何参数也要合法
  try {
    motorVelocities(initial.positions, initial.velocities);
  } catch (error) {
    if (!errorMessage(error).includes("相对原点的距离为0")) throw error;
  }
  const duration = I(endMs).sub(startMs).div(unitMs);
  const rate = I(1000).div(unitMs);
  const overflow = "两点/四点多项式区间计算溢出，请检查系数的数值范围";
  const bernstein = (axis: number, velocity: boolean) =>
    bernsteinControls(piece, axis, velocity, duration, rate, overflow, false);
  const zeroCurve = () => [I(0)];
  const curves: Curves = [
    bernstein(0, false),
    angleAxis !== null ? bernstein(angleAxis, false) : zeroCurve(),
    bernstein(0, true),
    angleAxis !== null ? bernstein(angleAxis, true) : zeroCurve(),
  ];
  const isZeroCurve = (curve: SpeedInterval[]) => curve.length === 1 && curve[0]!.isZero();
  const pureH = angleAxis === null || isZeroCurve(curves[1]!);
  if (isZeroCurve(curves[2]!) && isZeroCurve(curves[3]!)) return 0;

  const bound = (current: Curves): number => {
    if (pureH) return controlRange(current[2]!).maxAbs();
    const [h, a, vh, va] = current.map(controlRange) as [SpeedInterval, SpeedInterval, SpeedInterval, SpeedInterval];
    return twoPointMotorSpeedUpper(h, a, vh, va, base1, base2, length / 2, maxHeight);
  };
  const instantaneous = (x: number): number => {
    const timeMs = x === 0 ? startMs : x === 1 ? endMs : startMs + x * (endMs - startMs);
    const { positions: q, velocities: v } = calculateVirtualState(piece, timeMs, unitMs);
    if (pureH) return Math.abs(v[0]);
    try {
      return Math.max(...motorVelocities(q, v).map(Math.abs));
    } catch (error) {
      if (!errorMessage(error).includes("相对原点的距离为0")) throw error;
      // 距离在原点不可双侧求导，速度绝对值用相对速度范数的单侧极限包围
      const axis = angleAxis!;
      return twoPointMotorSpeedUpper(I(q[0]), I(q[axis]), I(v[0]), I(v[axis]), base1, base2, length / 2, maxHeight);
    }
  };

  const candidates = new Set([0, 0.5, 1]);
  for (const axis of angleAxis !== null ? [0, angleAxis] : [0]) {
    for (const root of accelerationRoots(piece, axis, unitMs)) candidates.add(root);
  }
  let best = Math.max(...[...candidates].map(instantaneous));
  let initialUpper = bound(curves);
  if (!Number.isFinite(initialUpper)) throw new Error("两点/四点速度上界不是有限数值，请检查系数和几何参数");
  initialUpper = Math.max(best, initialUpper);
  const heap = new BinaryHeap<HeapEntry>(heapOrder);
  heap.push({ negativeUpper: -initialUpper, sequence: 0, left: 0, right: 1, curves });
  let sequence = 0;
  let retiredUpper = best;
  for (let iteration = 0; iteration < 4096; iteration += 1) {
    const top = heap.peek();
    if (!top) return nextUp(Math.max(best, retiredUpper));
    const maximumUpper = Math.max(best, retiredUpper, -top.negativeUpper);
    if (maximumUpper - best <= Math.max(1e-9, best * 1e-4)) return nextUp(maximumUpper);
    const entry = heap.pop()!;
    if (-entry.negativeUpper <= best) {
      retiredUpper = Math.max(retiredUpper, -entry.negativeUpper);
      continue;
    }
    const middle = (entry.left + entry.right) / 2;
    if (middle === entry.left || middle === entry.right) {
      // 到浮点分辨率仍未收敛时保留上界，不替换成低估的采样值
      return nextUp(Math.max(maximumUpper, -entry.negativeUpper));
    }
    best = Math.max(best, instantaneous(middle));
    const halves = entry.curves.map(splitControls);
    const sides: Array<[number, number]> = [
      [entry.left, middle],
      [middle, entry.right],
    ];
    sides.forEach(([left, right], side) => {
      const child = halves.map((pair) => pair[side]!);
      const upper = bound(child);
      if (!Number.isFinite(upper)) throw new Error("两点/四点速度上界不是有限数值，请检查系数和几何参数");
      if (upper <= best) {
        retiredUpper = Math.max(retiredUpper, upper);
      } else {
        sequence += 1;
        heap.push({ negativeUpper: -upper, sequence, left, right, curves: child });
      }
    });
  }
  // 预算耗尽只影响保守程度，不丢弃尚未检查的上界
  const top = heap.peek();
  return nextUp(Math.max(best, retiredUpper, top ? -top.negativeUpper : 0));
};

type MultiEdge = {
  x: number;
  y: number;
  dx: SpeedInterval;
  dy: SpeedInterval;
  cross: SpeedInterval;
  rmin: number;
  rmax: number;
};

type MultiGeometry = {
  points: Hpy[];
  edges: MultiEdge[];
  base1: number;
  base2: number;
  maxHeight: number;
  betaInit: number;
};

/** _prepare_multi_point_geometry：吊点按边界顺序，原点位于内部核 */
const prepareMultiPointGeometry = (model: AlgorithmModel): MultiGeometry => {
  const points = (model.point_init_pos ?? []).map((point) => point.map(Number) as Hpy);
  if (points.length < 3 || points.some((point) => point.length !== 3 || !point.every(Number.isFinite))) {
    throw new Error("多点吊点必须是至少三个有限XYZ坐标");
  }
  const [base1, base2, maxHeight, betaInit] = [model.Baseheight1, model.Baseheight2, model.maxheight, model.betainit].map(Number) as [number, number, number, number];
  if (![base1, base2, maxHeight, betaInit].every(Number.isFinite)) throw new Error("多点几何参数必须是有限数值");
  if (!((base1 !== 0 && base2 === 0) || (base1 === 0 && base2 !== 0))) {
    throw new Error("多点正解要求上下原点恰好一个非0");
  }
  const edges: MultiEdge[] = [];
  let winding = 0;
  let orientation: number | null = null;
  points.forEach((p, index) => {
    const q = points[(index + 1) % points.length]!;
    const [x, y] = p;
    const cross = I(x).mul(q[1]).sub(I(y).mul(q[0]));
    const sign = cross.lo > 0 ? 1 : cross.hi < 0 ? -1 : 0;
    if (sign === 0 || (orientation !== null && sign !== orientation)) {
      throw new Error("多点吊点需按边界顺序排列，原点须严格位于边界内部核，不能有边穿过原点");
    }
    orientation = sign;
    winding += Math.atan2(x * q[1] - y * q[0], x * q[0] + y * q[1]);
    const edgeLength = I(q[0]).sub(x).square().add(I(q[1]).sub(y).square()).sqrt();
    const radiusMin = (sign > 0 ? cross : cross.neg()).div(edgeLength);
    const radiusMax = Math.max(
      I(x).square().add(I(y).square()).sqrt().hi,
      I(q[0]).square().add(I(q[1]).square()).sqrt().hi,
    );
    edges.push({ x, y, dx: I(q[0]).sub(x), dy: I(q[1]).sub(y), cross, rmin: radiusMin.lo, rmax: radiusMax });
  });
  if (Math.abs(Math.abs(winding) - 2 * Math.PI) > 1e-8) throw new Error("多点吊点边界不能重复绕行或交叉");
  return { points, edges, base1, base2, maxHeight, betaInit };
};

/** 包围多点正解在位置/速度区间内的实轴峰速，包含边切换及偏移限幅 */
const multiPointMotorSpeedUpper = (
  q: readonly SpeedInterval[],
  v: readonly SpeedInterval[],
  geometry: MultiGeometry,
): number => {
  const { points, edges, base1, base2, maxHeight, betaInit } = geometry;
  const [h, pitch, yaw] = q as [SpeedInterval, SpeedInterval, SpeedInterval];
  const [vh, vp, vy] = v as [SpeedInterval, SpeedInterval, SpeedInterval];
  const radians = I(Math.PI).div(180);
  const p = pitch.neg().mul(radians);
  const dp = vp.neg().mul(radians);
  const beta = yaw.add(betaInit).neg().mul(radians);
  const dbeta = vy.neg().mul(radians);
  const sine = beta.trig();
  const cosine = beta.trig(true);
  const sp = p.trig();
  const cp = p.trig(true);
  const distanceH = base1 !== 0 ? h.add(base1) : I(base2).add(maxHeight).sub(h);
  const distanceV = base1 !== 0 ? vh : vh.neg();
  // 射线 (-sin β, -cos β) 可能命中的边分别包围；切换到相邻边时同时包含两侧导数
  const radialCandidates: Array<[SpeedInterval, SpeedInterval]> = [];
  for (const edge of edges) {
    let den = sine.mul(edge.dy).sub(cosine.mul(edge.dx));
    const sign = edge.cross.lo > 0 ? 1 : -1;
    const positiveCross = sign > 0 ? edge.cross : edge.cross.neg();
    const positiveDen = sign > 0 ? den : den.neg();
    const possibleDen = positiveCross.div(I(edge.rmin, edge.rmax));
    const lo = Math.max(positiveDen.lo, possibleDen.lo);
    const hi = Math.min(positiveDen.hi, possibleDen.hi);
    if (lo > hi) continue;
    den = I(lo, hi).mul(sign);
    const u = cosine.mul(edge.x).sub(sine.mul(edge.y)).div(den);
    if (u.hi < 0 || u.lo > 1) continue;
    let radius = edge.cross.div(den);
    radius = I(Math.max(edge.rmin, radius.lo), Math.min(edge.rmax, radius.hi));
    if (radius.lo > radius.hi) continue;
    const denVelocity = cosine.mul(edge.dy).add(sine.mul(edge.dx)).mul(dbeta);
    const radiusVelocity = radius.square().div(edge.cross).neg().mul(denVelocity);
    radialCandidates.push([radius, radiusVelocity]);
  }
  if (radialCandidates.length === 0) throw new Error("多点射线未找到边界，请检查吊点坐标及角度数值范围");

  // 原偏移等价于 sign(p)·R·min(1,(|p|/1.5707963)^n)；直接在 [0,1] 上求幂
  const absP = I(p.lo <= 0 && 0 <= p.hi ? 0 : Math.min(Math.abs(p.lo), Math.abs(p.hi)), p.maxAbs());
  const signP = p.lo < 0 && 0 < p.hi ? I(-1, 1) : I(p.hi <= 0 ? -1 : 1);
  const ratio = absP.div(1.5707963);
  let upper = 0;
  for (const [radius, radiusVelocity] of radialCandidates) {
    const exponentRaw = I(1.73).add(distanceH.div(radius).mul(0.52));
    // 范围太宽时继续细分；不把无界导数当作 0
    if (exponentRaw.lo <= 1) return Number.POSITIVE_INFINITY;
    const exponent = I(Math.min(100, exponentRaw.lo), Math.min(100, exponentRaw.hi));
    let exponentVelocity = distanceV
      .div(radius)
      .sub(distanceH.mul(radiusVelocity).div(radius.square()))
      .mul(0.52);
    if (exponentRaw.lo >= 100) {
      exponentVelocity = I(0);
    } else if (exponentRaw.hi >= 100) {
      exponentVelocity = I(Math.min(0, exponentVelocity.lo), Math.max(0, exponentVelocity.hi));
    }
    let offset: SpeedInterval;
    let offsetVelocity: SpeedInterval;
    if (ratio.lo >= 1) {
      offset = signP.mul(radius);
      offsetVelocity = signP.mul(radiusVelocity);
    } else {
      const rho = I(Math.max(0, ratio.lo), Math.min(1, ratio.hi));
      const powerRange = (n: SpeedInterval): SpeedInterval => {
        let result = SpeedInterval.outward(rho.lo ** n.hi, rho.hi ** n.lo);
        // pow 结果外扩 8 ulp
        for (let index = 0; index < 7; index += 1) result = SpeedInterval.outward(result.lo, result.hi);
        return I(Math.max(0, result.lo), Math.min(1, result.hi));
      };
      const weight = powerRange(exponent);
      const slopeWeight = powerRange(exponent.sub(I(1)));
      // |rho^n·log(rho)| 的最大值：端点及 rho=exp(-1/n_min)
      const nMin = exponent.lo;
      const logWeight = (r: number) => (r === 0 ? 0 : -(r ** nMin) * Math.log(r));
      let logMax = Math.max(logWeight(rho.lo), logWeight(rho.hi));
      if (rho.lo <= Math.exp(-1 / nMin) && Math.exp(-1 / nMin) <= rho.hi) {
        logMax = Math.max(logMax, 1 / (Math.E * nMin));
      }
      for (let index = 0; index < 16; index += 1) logMax = nextUp(logMax);
      let logMin = Math.min(
        ...[rho.lo, rho.hi].map((r) => (r === 0 ? 0 : -(r ** exponent.hi) * Math.log(r))),
      );
      for (let index = 0; index < 16; index += 1) logMin = nextDown(logMin);
      const weightLog = I(-logMax, -Math.max(0, logMin));
      offset = signP.mul(radius).mul(weight);
      offsetVelocity = signP
        .mul(radiusVelocity.mul(weight).add(radius.mul(weightLog).mul(exponentVelocity)))
        .add(radius.mul(exponent).mul(slopeWeight).mul(dp.div(1.5707963)));
      if (ratio.hi >= 1) {
        const saturated = signP.mul(radiusVelocity);
        offsetVelocity = I(
          Math.min(offsetVelocity.lo, saturated.lo),
          Math.max(offsetVelocity.hi, saturated.hi),
        );
      }
    }
    for (const point of points) {
      const [x, y] = point;
      const t = sine.mul(x).add(cosine.mul(y));
      const dt = cosine.mul(x).sub(sine.mul(y)).mul(dbeta);
      // Rz(-β)Rx(p)Rz(β) 的水平位移始终沿 (sin β, cos β)；距离只需水平/垂直分量
      const horizontal = cp.sub(I(1)).mul(t).add(offset);
      const horizontalVelocity = sp.neg().mul(dp).mul(t).add(cp.sub(I(1)).mul(dt)).add(offsetVelocity);
      const vertical = sp.mul(t).sub(distanceH);
      const verticalVelocity = cp.mul(dp).mul(t).add(sp.mul(dt)).sub(distanceV);
      let projected: SpeedInterval;
      if (vertical.lo > 0 || vertical.hi < 0) {
        // 先求水平/垂直比，消去大参考高度
        const directionRatio = horizontal.div(vertical);
        projected = verticalVelocity
          .add(directionRatio.mul(horizontalVelocity))
          .div(I(1).add(directionRatio.square()).sqrt());
      } else {
        projected = motorDirectionInterval(horizontal, vertical)
          .mul(horizontalVelocity)
          .add(motorDirectionInterval(vertical, horizontal).mul(verticalVelocity));
      }
      let normUpper = Math.hypot(horizontalVelocity.maxAbs(), verticalVelocity.maxAbs());
      for (let index = 0; index < 4; index += 1) normUpper = nextUp(normUpper);
      upper = Math.max(upper, Math.min(projected.maxAbs(), normUpper));
    }
  }
  if (!Number.isFinite(upper)) throw new Error("多点速度区间计算溢出，请检查原轨迹和几何参数");
  return nextUp(upper);
};

/** 多点正解的解析瞬时峰速，用作区间搜索的候选值（不是整段上界） */
const multiPointInstantaneousSpeed = (q: Hpy, v: Hpy, geometry: MultiGeometry): number => {
  const { points, edges, base1, base2, maxHeight, betaInit } = geometry;
  const [h, pitch, yaw] = q;
  const [vh, vp, vy] = v;
  const p = (-pitch * Math.PI) / 180;
  const dp = (-vp * Math.PI) / 180;
  const beta = (-(yaw + betaInit) * Math.PI) / 180;
  const dbeta = (-vy * Math.PI) / 180;
  const sine = Math.sin(beta);
  const cosine = Math.cos(beta);
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  const height = base1 !== 0 ? h + base1 : base2 + maxHeight - h;
  const heightVelocity = base1 !== 0 ? vh : -vh;
  const candidates: Array<[number, number]> = [];
  for (const edge of edges) {
    // 用原始顶点计算标量；边界处允许两个相邻边的单侧速度
    const dx = (edge.dx.lo + edge.dx.hi) * 0.5;
    const dy = (edge.dy.lo + edge.dy.hi) * 0.5;
    const den = sine * dy - cosine * dx;
    if (den === 0) continue;
    const radius = (edge.x * dy - edge.y * dx) / den;
    const u = (cosine * edge.x - sine * edge.y) / den;
    if (radius > 0 && -1e-12 <= u && u <= 1 + 1e-12) {
      const radiusVelocity = (-radius * (cosine * dy + sine * dx) * dbeta) / den;
      candidates.push([radius, radiusVelocity]);
    }
  }
  if (candidates.length === 0) {
    // 极端舍入/角度数值用单点区间包围；不退回平均速度
    return multiPointMotorSpeedUpper(q.map((value) => I(value)), v.map((value) => I(value)), geometry);
  }
  const minimum = Math.min(...candidates.map(([radius]) => radius));
  let upper = 0;
  for (const [radius, radiusVelocity] of candidates) {
    if (radius > minimum * (1 + 1e-10)) continue;
    const nRaw = 1.73 + (0.52 * height) / radius;
    if (nRaw <= 1) throw new Error("多点偏移幂需大于1，当前原轨迹可能在P=0处不可导，请检查参考高度");
    const n = Math.min(100, nRaw);
    const nVelocity =
      nRaw >= 100 ? 0 : 0.52 * (heightVelocity / radius - (height * radiusVelocity) / radius ** 2);
    const rho = Math.abs(p) / 1.5707963;
    const sign = p < 0 ? -1 : 1;
    let offset: number;
    let offsetVelocity: number;
    if (rho >= 1) {
      offset = sign * radius;
      offsetVelocity = sign * radiusVelocity;
    } else if (rho === 0) {
      offset = 0;
      offsetVelocity = 0;
    } else {
      const weight = rho ** n;
      offset = sign * radius * weight;
      offsetVelocity =
        sign * (radiusVelocity * weight + radius * weight * Math.log(rho) * nVelocity) +
        (radius * n * rho ** (n - 1) * dp) / 1.5707963;
    }
    for (const [x, y] of points) {
      const t = sine * x + cosine * y;
      const dt = (cosine * x - sine * y) * dbeta;
      const horizontal = (cp - 1) * t + offset;
      const horizontalVelocity = -sp * dp * t + (cp - 1) * dt + offsetVelocity;
      const vertical = sp * t - height;
      const verticalVelocity = cp * dp * t + sp * dt - heightVelocity;
      const length = Math.hypot(horizontal, vertical);
      const speed =
        length === 0
          ? Math.hypot(horizontalVelocity, verticalVelocity)
          : Math.abs((horizontal / length) * horizontalVelocity + (vertical / length) * verticalVelocity);
      upper = Math.max(upper, speed);
    }
  }
  if (!Number.isFinite(upper)) throw new Error("多点瞬时速度计算溢出");
  return upper;
};

/** calculate_multi_piece_max_velocity：多点一个系数阶段的峰速上界 */
const multiPieceMaxVelocity = (piece: Piece, geometry: MultiGeometry, unitMs: number): number => {
  const start = Number(piece.start_frame);
  const end = Number(piece.end_frame);
  calculateVirtualState(piece, start, unitMs);
  const duration = I(end).sub(start).div(unitMs);
  const rate = I(1000).div(unitMs);
  const overflow = "多点多项式区间溢出，请检查系数数值范围";
  const curves: Curves = [false, true].flatMap((velocity) =>
    [0, 1, 2].map((axis) => bernsteinControls(piece, axis, velocity, duration, rate, overflow, true)),
  );
  const isZeroCurve = (curve: SpeedInterval[]) => curve.length === 1 && curve[0]!.isZero();
  if (curves.slice(3).every(isZeroCurve)) return 0;
  // P 恒为 0 时只是 H 平移，Y 只改方向不改绳长
  const pureH = isZeroCurve(curves[1]!);
  const bound = (current: Curves): number => {
    const values = current.map(controlRange);
    return pureH ? values[3]!.maxAbs() : multiPointMotorSpeedUpper(values.slice(0, 3), values.slice(3), geometry);
  };
  const instantaneous = (x: number): number => {
    const timeMs = x === 0 ? start : x === 1 ? end : start + x * (end - start);
    const { positions, velocities } = calculateVirtualState(piece, timeMs, unitMs);
    return pureH ? Math.abs(velocities[0]) : multiPointInstantaneousSpeed(positions, velocities, geometry);
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

const GEOMETRY_FIELDS: Record<number, readonly (keyof AlgorithmModel)[]> = {
  2: [],
  6: ["BaseHight1", "BaseHight2", "lLenth_inside", "maxheight"],
  7: ["BaseHight1", "BaseHight2", "lLenth_inside", "wLenth_inside", "maxheight", "moveWhat"],
  8: ["point_init_pos", "Baseheight1", "Baseheight2", "maxheight", "betainit"],
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

/** calculate_velocity_adjust：各模型 本模型实轴限速 ÷ 原动作峰速 的最小值，带分类上限 */
const calculateVelocityAdjust = (
  models: readonly AlgorithmModel[],
  unitMs: number,
  classificationMaxFactor: number,
): number => {
  let velocityAdjust = classificationMaxFactor;
  // 只在本次计算中复用相同动作段的峰速
  const cache = new Map<string, number>();
  for (const model of models) {
    const modelType = model.model_type;
    const geometryKey = JSON.stringify([
      modelType,
      JSON.stringify((GEOMETRY_FIELDS[modelType] ?? []).map((name) => model[name] ?? null)),
    ]);
    const segmentPeak = (segment: ActionSegment, pieceMax: (piece: Piece) => number): number => {
      calculateVirtualState(segment, segment.start_frame, unitMs);
      const key = segmentVelocityKey(segment, geometryKey, unitMs);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      let peak = 0;
      for (const piece of piecesOf(segment)) peak = Math.max(peak, pieceMax(piece));
      cache.set(key, peak);
      return peak;
    };
    const motorLimitOf = (label: string): number => {
      const limit = Number(model.max_motor_velocity);
      if (!Number.isFinite(limit) || limit <= 0) throw new Error(`${label}模型max_motor_velocity必须是有限的正数`);
      return limit;
    };
    let modelMaxVelocity = 0;
    let motorLimit: number;
    switch (modelType) {
      case 2: {
        // 单点：实轴速度直接由 H 轴速度得到；梯形看各阶段两端，高阶系数再看内部极值
        motorLimit = model.max_motor_velocity;
        for (const segment of model.segments) {
          const peak = segmentPeak(segment, (piece) => {
            const startMs = Number(piece.start_frame);
            const endMs = Number(piece.end_frame);
            const times = [startMs, endMs];
            for (const x of accelerationRoots(piece, 0, unitMs)) times.push(startMs + x * (endMs - startMs));
            let pieceMax = 0;
            for (const timeMs of times) {
              pieceMax = Math.max(pieceMax, Math.abs(calculateVirtualState(piece, timeMs, unitMs).velocities[0]));
            }
            return pieceMax;
          });
          modelMaxVelocity = Math.max(modelMaxVelocity, peak);
        }
        break;
      }
      case 6:
      case 7: {
        motorLimit = motorLimitOf(modelType === 6 ? "两点" : "四点");
        for (const segment of model.segments) {
          const peak = segmentPeak(segment, (piece) => twoFourPieceMaxVelocity(piece, model, unitMs));
          modelMaxVelocity = Math.max(modelMaxVelocity, peak);
        }
        break;
      }
      case 8: {
        motorLimit = motorLimitOf("多点");
        const geometry = prepareMultiPointGeometry(model);
        for (const segment of model.segments) {
          const peak = segmentPeak(segment, (piece) => multiPieceMaxVelocity(piece, geometry, unitMs));
          modelMaxVelocity = Math.max(modelMaxVelocity, peak);
        }
        break;
      }
      default:
        throw new Error(`不支持的模型类型：${modelType}，目前只支持 2、6、7、8`);
    }
    if (modelMaxVelocity > 0) velocityAdjust = Math.min(velocityAdjust, motorLimit / modelMaxVelocity);
  }
  return velocityAdjust;
};

const MODEL_NAMES: Record<number, string> = { 2: "单点", 6: "两点", 7: "四点", 8: "多点" };

type AxisPhase = [name: string, startMs: number, endMs: number];

/** 非强制按单点 / 同步非单点 / 不同步分类；只要任意非单点模型有一段不同步，整个动作最高 100% */
const classifyNonForced = (
  models: readonly AlgorithmModel[],
  unitMs: number,
): { category: string; maxFactor: number } => {
  let allSinglePoint = true;
  let allNonSingleSynchronized = true;
  for (const model of models) {
    if (!(model.model_type in MODEL_NAMES)) {
      throw new Error(`不支持的模型类型：${model.model_type}，目前只支持 2、6、7、8`);
    }
    if (!model.segments || model.segments.length === 0) throw new Error("每个模型至少需要一段动作");
    if (model.model_type === 2) continue;
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
  if (allSinglePoint) return { category: "全部单点：可升速、可降速", maxFactor: Number.POSITIVE_INFINITY };
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
