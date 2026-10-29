/**
 * python/就近计算 与 python/调速范围计算 共用的 算法参数.json 结构。
 * 字段名照搬 JSON（含 BaseHight1、lLenth_inside 等原拼写），三个算法读同一份 models。
 */

export type Hpy = [number, number, number];

export type AxisName = "H" | "P" | "Y";

export const AXIS_NAMES: readonly AxisName[] = ["H", "P", "Y"];

export const COEFFICIENT_NAMES = ["a", "b", "c", "d", "e", "f"] as const;

export type CoefficientName = (typeof COEFFICIENT_NAMES)[number];

/** 一个系数阶段：q(u)=a+b·u+…+f·u⁵，u=(帧-start_frame)/系数时间单位 */
export type CoefficientPiece = {
  segment_id?: number;
  start_frame: number;
  end_frame: number;
  start_HPY?: Hpy;
  target_HPY?: Hpy;
} & Record<CoefficientName, Hpy>;

/** 原动作段；系数可以直接写在段上，也可以拆成 coefficient_segments */
export type ActionSegment = {
  segment_id?: number;
  start_frame: number;
  end_frame: number;
  start_HPY?: Hpy;
  target_HPY?: Hpy;
  coefficient_segments?: CoefficientPiece[];
} & Partial<Record<CoefficientName, Hpy>>;

export type AlgorithmModel = {
  plc_id: string;
  model_id: number;
  device_id: number;
  /** 业务类型：2 单点、6 两点、7 四点、8 多点 */
  model_type: number;
  motor_num?: number;
  active_axes?: AxisName[];
  follow_axes?: AxisName[];
  prepare_axes?: AxisName[];
  max_motor_velocity: number;
  max_velocity_HPY: Hpy;
  max_acceleration_HPY: Hpy;
  max_deceleration_HPY: Hpy;
  default_velocity_HPY: Hpy;
  default_acceleration_HPY: Hpy;
  default_deceleration_HPY: Hpy;
  min_position_HPY?: Hpy;
  max_position_HPY?: Hpy;
  segments: ActionSegment[];
  BaseHight1?: number;
  BaseHight2?: number;
  lLenth_inside?: number;
  wLenth_inside?: number;
  maxheight?: number;
  moveWhat?: number;
  Baseheight1?: number;
  Baseheight2?: number;
  point_init_pos?: Hpy[];
  betainit?: number;
};

export type AlgorithmSettings = {
  forced_coefficient_time_unit_ms?: number;
  curve_time_unit_ms?: number;
  model_type_scheme?: "business" | "geometry";
  coarse_step_ms?: number;
  fine_step_ms?: number;
  [key: string]: unknown;
};

export type RuntimeModelState = {
  model_id: number;
  plc_id?: string;
  device_id?: number;
  position_HPY: Hpy;
  velocity_HPY: Hpy;
  standstill: boolean;
};

export type NearestCommand = {
  trajectory_run: boolean;
  reverse?: boolean;
  loop_once?: boolean;
  nearest_start?: boolean;
  use_specified_time?: boolean;
  specified_time_ms?: number;
  stopped_time_ms?: number | null;
  loop_count?: number;
  [key: string]: unknown;
};

export type NearestParameters = {
  command: NearestCommand;
  settings?: AlgorithmSettings;
  models: AlgorithmModel[];
  runtime: { elapsed_ms?: number; models: RuntimeModelState[] };
};

export type RangeParameters = {
  command: { trajectory_run: boolean; [key: string]: unknown };
  settings: AlgorithmSettings;
  models: AlgorithmModel[];
};

/** _number：拒绝布尔、NaN、无穷 */
export const finiteNumber = (value: unknown, name: string, nonnegative = false): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name}必须是有限数值`);
  }
  if (nonnegative && value < 0) throw new Error(`${name}不能小于0`);
  return value;
};

/** _hpy：三项有限数值 */
export const hpyOf = (values: unknown, name: string, nonnegative = false): Hpy => {
  if (!Array.isArray(values) || values.length !== 3) {
    throw new Error(`${name}必须是H/P/Y三项数组`);
  }
  return [
    finiteNumber(values[0], name, nonnegative),
    finiteNumber(values[1], name, nonnegative),
    finiteNumber(values[2], name, nonnegative),
  ];
};

/** _axes：非空、不重复的 H/P/Y 轴名 */
export const axesOf = (values: unknown, name: string): AxisName[] => {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${name}必须是非空轴名列表`);
  }
  const upper = values.map((value) =>
    typeof value === "string" ? value.toUpperCase() : value,
  );
  if (upper.some((value) => !AXIS_NAMES.includes(value as AxisName))) {
    throw new Error(`${name}只能填写H、P、Y`);
  }
  if (new Set(upper).size !== upper.length) throw new Error(`${name}不能有重复轴`);
  return upper as AxisName[];
};

export const axisIndex = (name: AxisName): 0 | 1 | 2 => AXIS_NAMES.indexOf(name) as 0 | 1 | 2;

/** 曲线变量每增加 1 是 100ms；归一后的系数都按这个单位 */
export const CURVE_TICK_FRAME = 100;

/** _evaluate_base_action_segment：位置与每秒速度 */
export const evaluatePiece = (
  piece: Pick<CoefficientPiece, "start_frame" | CoefficientName>,
  frameMs: number,
): { positions: Hpy; velocities: Hpy } => {
  const t = (frameMs - piece.start_frame) / CURVE_TICK_FRAME;
  const positions: Hpy = [0, 0, 0];
  const velocities: Hpy = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    const a = piece.a[axis]!;
    const b = piece.b[axis]!;
    const c = piece.c[axis]!;
    const d = piece.d[axis]!;
    const e = piece.e[axis]!;
    const f = piece.f[axis]!;
    positions[axis] = ((((f * t + e) * t + d) * t + c) * t + b) * t + a;
    const perTick = (((5 * f * t + 4 * e) * t + 3 * d) * t + 2 * c) * t + b;
    // 曲线变量每增加 1 代表 0.1 秒，换算每秒速度乘 10
    velocities[axis] = perTick * 10;
  }
  return { positions, velocities };
};

/** bisect_right：第一个大于 value 的下标 */
export const bisectRight = (sorted: readonly number[], value: number): number => {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (value < sorted[middle]!) high = middle;
    else low = middle + 1;
  }
  return low;
};

const bitsView = new Float64Array(1);
const bitsWord = new BigUint64Array(bitsView.buffer);

/** math.nextafter：x 朝 toward 方向的相邻浮点数 */
export const nextAfter = (x: number, toward: number): number => {
  if (Number.isNaN(x) || Number.isNaN(toward)) return Number.NaN;
  if (x === toward) return toward;
  if (x === 0) return toward > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  bitsView[0] = x;
  // 正数往大、负数往小时绝对值变大，位模式加一
  bitsWord[0] = toward > x === x > 0 ? bitsWord[0]! + 1n : bitsWord[0]! - 1n;
  return bitsView[0]!;
};

/** math.ulp：|x| 到下一个更大浮点数的距离；最大有限数取向下的距离 */
export const ulp = (x: number): number => {
  if (Number.isNaN(x)) return x;
  const magnitude = Math.abs(x);
  if (magnitude === Number.POSITIVE_INFINITY) return magnitude;
  const next = nextAfter(magnitude, Number.POSITIVE_INFINITY);
  if (next === Number.POSITIVE_INFINITY) return magnitude - nextAfter(magnitude, Number.NEGATIVE_INFINITY);
  return next - magnitude;
};

/**
 * math.fsum：照 CPython 的 Shewchuk 部分和求正确舍入的和；
 * 中间溢出、-inf 与 inf 相加时和 Python 一样抛错，NaN 原样返回。
 */
export const fsum = (values: Iterable<number>): number => {
  const partials: number[] = [];
  let specialSum = 0;
  let infSum = 0;
  for (const value of values) {
    let x = value;
    let count = 0;
    for (let index = 0; index < partials.length; index += 1) {
      let y = partials[index]!;
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) partials[count++] = lo;
      x = hi;
    }
    partials.length = count;
    if (x === 0) continue;
    if (!Number.isFinite(x)) {
      if (Number.isFinite(value)) throw new RangeError("intermediate overflow in fsum");
      if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) infSum += value;
      specialSum += value;
      partials.length = 0;
    } else {
      partials.push(x);
    }
  }
  if (specialSum !== 0) {
    if (Number.isNaN(infSum)) throw new RangeError("-inf + inf in fsum");
    return specialSum;
  }
  let remaining = partials.length;
  if (remaining === 0) return 0;
  let hi = partials[--remaining]!;
  let lo = 0;
  while (remaining > 0) {
    const x = hi;
    const y = partials[--remaining]!;
    hi = x + y;
    lo = y - (hi - x);
    if (lo !== 0) break;
  }
  // 跨多个部分和也按“四舍六入五成双”：sum([1e-16, 1, 1e16]) 要进到 …02
  if (remaining > 0 && ((lo < 0 && partials[remaining - 1]! < 0) || (lo > 0 && partials[remaining - 1]! > 0))) {
    const y = lo * 2;
    const x = hi + y;
    if (y === x - hi) hi = x;
  }
  return hi;
};

/** Python 浮点取模：结果与除数同号 */
export const pythonMod = (value: number, divisor: number): number => {
  const remainder = value % divisor;
  return remainder !== 0 && remainder < 0 !== divisor < 0 ? remainder + divisor : remainder;
};
