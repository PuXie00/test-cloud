import { solveMultiPointForward, type Vec3 } from "@/app/kinematics/multi-point-forward";
import {
  AXIS_NAMES,
  axesOf,
  axisIndex,
  bisectRight,
  COEFFICIENT_NAMES,
  CURVE_TICK_FRAME,
  evaluatePiece,
  finiteNumber,
  fsum,
  hpyOf,
  nextAfter,
  pythonMod,
  ulp,
  type AlgorithmModel,
  type AlgorithmSettings,
  type AxisName,
  type CoefficientName,
  type Hpy,
  type NearestParameters,
  type RuntimeModelState,
} from "./algorithm-params";
import {
  fourPointForward,
  minimumMotionProfile,
  scaleMotionParameters,
  twoPointForward,
  type AxisVad,
} from "./nearest-start-motion";

/**
 * 逐项移植 python/新就近算法/就近接入计算.py 的停稳同步准备（_calculate_nearest_entry_v4）：
 * 指定帧（use_specified_time）强制直接接入；就近时以 stopped_time_ms 为方向边界，
 * 强制按 PLC 规则粗细搜索位置最近的帧，非强制沿运行方向取最近的原动作关键帧；
 * 两种都按最大 V/A/D 规划零速起止 Move，所有模型同时到达，实轴超速时共同降速。
 * 非强制带速接入（v8）不移植：它的结果要 PLC 支持按时刻覆盖的轴队列才能执行。
 */

export const NEAREST_ALGORITHM_VERSION = "v5_max_capability_common_prepare";
export const FRAME_SELECTION_VERSION = "directional_nearest_return_branch_fix_20261028_r2";

const UINT32_MAX = 4294967295;
const MAX_PREPARE_TIME_MS = UINT32_MAX;
const RAD = Math.PI / 180;

type GeometryKind = 1 | 2 | 4 | 8;

type FlatPiece = {
  segment_id: number;
  start_frame: number;
  end_frame: number;
  start_HPY: Hpy;
  target_HPY: Hpy;
} & Record<CoefficientName, Hpy>;

type Route = { plc_id: string; model_id: number; device_id: number; model_type: number };

type VadHpy = { velocity: Hpy; acceleration: Hpy; deceleration: Hpy };

type EntryModel = {
  index: number;
  route: Route;
  kind: GeometryKind;
  motorNum: number;
  pieces: FlatPiece[];
  pieceStarts: number[];
  boundaries: number[];
  supported: readonly AxisName[];
  maxMotorVelocity: number;
  geometry: Partial<Record<(typeof GEOMETRY_NUMBER_FIELDS)[number], number>>;
  moveWhat: unknown;
  pointInitPos: Hpy[] | undefined;
  current: Hpy;
  /** Python 的 active_axes_by_model：准备轴 */
  prepare: AxisName[];
  follow: AxisName[];
  defaults: VadHpy;
  max: VadHpy;
};

type EntryInputs = {
  trajectoryRun: boolean;
  direction: 1 | -1;
  loopOnce: boolean;
  loopCount: number;
  nearestStart: boolean;
  useSpecifiedTime: boolean;
  specifiedTimeMs: number;
  stoppedTimeMs: number | null;
  coarseStep: number;
  fineStep: number;
  models: EntryModel[];
};

export type NearestEntryStartMode = "action_boundary" | "nearest";

/** specified_frame：固定接入指定帧；directional_nearest：从参考帧按方向找位置最近的帧；action_boundary：首末边界 */
export type NearestEntryFrameSelectionMode = "specified_frame" | "directional_nearest" | "action_boundary";

/** evaluated_frames 是实际评分次数；full_fine_grid_covered 表示细网格都比较过或被安全排除 */
export type NearestSearchStatistics = {
  method: "position_envelope_branch_and_bound";
  evaluated_frames: number;
  bound_intervals: number;
  pruned_grid_frames: number;
  full_fine_grid_covered: true;
  fine_grid_frames: number;
  normalized_position_tolerance: number;
};

export type NearestEntryModelResult = Route & {
  current_HPY: Hpy;
  curve_target_HPY: Hpy;
  target_HPY: Hpy;
  velocity_HPY: Hpy;
  acceleration_HPY: Hpy;
  deceleration_HPY: Hpy;
  execute_HPY: [boolean, boolean, boolean];
  expected_arrival_ms: number;
  motor_velocity_upper_bound: number;
  max_motor_velocity: number;
};

export type NearestEntryPayload = {
  plc_id: string;
  selectedCurveTimeMs: number;
  loopCount: number;
  prepareTimeMs: number;
  devices: {
    deviceID: number;
    model_id: number;
    velocity_HPY: Hpy;
    acceleration_HPY: Hpy;
    deceleration_HPY: Hpy;
    execute_HPY: [boolean, boolean, boolean];
  }[];
};

export type NearestEntryResult = {
  status: "planned";
  can_dispatch: true;
  message: string;
  requires_group_wait: boolean;
  trajectory_run: boolean;
  reverse: boolean;
  effective_loop_once: boolean;
  effective_loop_count: number;
  loop_fallback: { plc_id: string; model_id: number; axis: AxisName; reason: string }[];
  /** 选中的原曲线公共接入帧，ms；搜索模式下可以不同于输入的停止帧 */
  selected_curve_time_ms: number;
  frame_selection_mode: NearestEntryFrameSelectionMode;
  frame_selection_version: string;
  /** 指定模式为指定帧，搜索模式为输入停止帧（未给为 null）；不是最终接入帧 */
  reference_frame_ms: number | null;
  search_origin_frame_ms: number;
  /** 实际允许的原曲线搜索区间 [最小帧, 最大帧] */
  search_range_ms: [number, number];
  selection_metric: "nearest_position";
  position_metric: string;
  /** 强制方向搜索的区间包络统计；其它方式为空对象 */
  search_statistics: NearestSearchStatistics | Record<string, never>;
  /** 所有模型共同准备耗时，ms */
  prepare_time_ms: number;
  /** 1006 prepareTimeMs：共同准备耗时向上取整 */
  prepare_time_ms_ceil: number;
  start_mode: NearestEntryStartMode;
  motor_limit_scale: number;
  stationary_plc_ids: string[];
  all_stationary: boolean;
  devices: { plc_id: string; models: NearestEntryModelResult[] }[];
  "1006_payloads": NearestEntryPayload[];
  skipped_candidates: { frame_ms: number; reason: string }[];
  algorithm_version: string;
};

const GEOMETRY_KIND_BY_BUSINESS: Record<number, GeometryKind> = { 2: 1, 6: 2, 7: 4, 8: 8 };

const SUPPORTED_AXES: Record<GeometryKind, readonly AxisName[]> = {
  1: ["H"],
  2: ["H", "P"],
  4: ["H", "P", "Y"],
  8: ["H", "P", "Y"],
};

const GEOMETRY_NUMBER_FIELDS = [
  "BaseHight1",
  "BaseHight2",
  "Baseheight1",
  "Baseheight2",
  "lLenth_inside",
  "wLenth_inside",
  "maxheight",
  "betainit",
] as const;

const isInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isClose = (left: number, right: number, relTol: number): boolean =>
  left === right || Math.abs(left - right) <= relTol * Math.max(Math.abs(left), Math.abs(right));

const lastOf = <T>(items: readonly T[]): T => items[items.length - 1]!;

/** _adapt_shared_nearest_parameters 的时间单位：同时给两种且不同则拒绝 */
const curveTimeUnitOf = (settings: AlgorithmSettings): number => {
  const names = ["forced_coefficient_time_unit_ms", "curve_time_unit_ms"] as const;
  const units: number[] = [];
  for (const name of names) {
    if (!(name in settings)) continue;
    const value = finiteNumber(settings[name], name);
    if (value <= 0) throw new Error(`${name}必须大于0`);
    units.push(value);
  }
  if (units.length === 2 && units[0] !== units[1]) {
    throw new Error("forced_coefficient_time_unit_ms与curve_time_unit_ms不一致");
  }
  return units[0] ?? 100;
};

/** runtime.models 按 model_id 关联真实位置、速度和停稳状态 */
const runtimeStatesOf = (parameters: NearestParameters): Map<number, RuntimeModelState> => {
  const items = parameters.models;
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.some((model) => typeof model !== "object" || model === null)
  ) {
    throw new Error("公共models必须为非空模型对象列表");
  }
  const runtime = parameters.runtime;
  if (typeof runtime !== "object" || runtime === null || !Array.isArray(runtime.models)) {
    throw new Error("runtime必须是对象，且runtime.models必须为列表");
  }
  const models = new Map<number, AlgorithmModel>();
  for (const model of items) {
    const key = model.model_id;
    if (!isInteger(key) || key <= 0 || models.has(key)) {
      throw new Error("公共models的model_id必须是全动作唯一正整数");
    }
    models.set(key, model);
  }
  const states = new Map<number, RuntimeModelState>();
  for (const state of runtime.models) {
    if (typeof state !== "object" || state === null) throw new Error("runtime.models每项必须是对象");
    const key = state.model_id;
    if (!isInteger(key) || key <= 0 || states.has(key) || !models.has(key)) {
      throw new Error("runtime模型编号重复、无效或不属于本动作");
    }
    states.set(key, state);
  }
  if (states.size !== models.size) throw new Error("runtime.models必须完整覆盖本动作全部模型");
  for (const [key, original] of models) {
    const state = states.get(key)!;
    for (const route of ["plc_id", "device_id"] as const) {
      const expected = original[route] ?? (route === "device_id" ? original.model_id : undefined);
      if (route in state && (typeof state[route] !== typeof expected || state[route] !== expected)) {
        throw new Error(`runtime模型${key}的${route}与静态模型路由冲突`);
      }
    }
    hpyOf(state.position_HPY, "runtime.position_HPY");
    const velocity = hpyOf(state.velocity_HPY, "runtime.velocity_HPY");
    if (typeof state.standstill !== "boolean") throw new Error("runtime.standstill必须明确为bool");
    if (state.standstill && velocity.some((value) => Math.abs(value) > 1e-7)) {
      throw new Error("runtime.standstill=true与非零速度矛盾");
    }
  }
  return states;
};

/** 原动作段 → 平铺系数阶段；系数按时间单位换算到 100ms 曲线变量，端点与连续性一并校验 */
const flattenSegments = (
  model: AlgorithmModel,
  unit: number,
): { pieces: FlatPiece[]; boundaries: number[] } => {
  const segments = model.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("每模型segments须为非空原动作段列表");
  }
  const flat: FlatPiece[] = [];
  const boundaries = new Set<number>();
  let previous: number | null = null;
  const closeTo = (left: Hpy, right: Hpy) =>
    left.every((value, axis) => Math.abs(value - right[axis]!) <= 1e-5);
  for (const segment of segments) {
    if (typeof segment !== "object" || segment === null) {
      throw new Error("segments每一项必须是动作段对象");
    }
    const start = segment.start_frame;
    const end = segment.end_frame;
    if (
      ![start, end].every((value) => isInteger(value) && value >= 0 && value <= UINT32_MAX) ||
      end <= start
    ) {
      throw new Error("原动作帧须为uint32整数毫秒，且end_frame>start_frame");
    }
    if (previous !== null && start < previous) throw new Error("原动作段须按时间排序且不能重叠");
    previous = end;
    boundaries.add(start);
    boundaries.add(end);
    const pieces = segment.coefficient_segments ?? [segment];
    if (!Array.isArray(pieces) || pieces.length === 0) {
      throw new Error("coefficient_segments必须为非空列表");
    }
    const firstIndex = flat.length;
    let cursor = start;
    for (const piece of pieces) {
      if (typeof piece !== "object" || piece === null) {
        throw new Error("coefficient_segments每一项必须是系数阶段对象");
      }
      const pieceEnd = piece.end_frame ?? cursor;
      // 曲线相位分界来自梯形加减速时长，可以不是整毫秒；原动作段（关键帧）仍须整毫秒
      if (
        piece.start_frame !== cursor ||
        typeof pieceEnd !== "number" ||
        !Number.isFinite(pieceEnd) ||
        pieceEnd <= cursor ||
        pieceEnd > end
      ) {
        throw new Error("系数阶段必须完整、连续覆盖原动作段");
      }
      const coefficients = {} as Record<CoefficientName, Hpy>;
      COEFFICIENT_NAMES.forEach((name, degree) => {
        const scale = (100 / unit) ** degree;
        const values = hpyOf(piece[name], name).map((value) => value * scale) as Hpy;
        if (!values.every(Number.isFinite)) throw new Error("系数时间单位换算后超出浮点范围");
        coefficients[name] = values;
      });
      const normalized: FlatPiece = {
        segment_id: piece.segment_id ?? segment.segment_id ?? flat.length,
        start_frame: cursor,
        end_frame: pieceEnd,
        start_HPY: [0, 0, 0],
        target_HPY: [0, 0, 0],
        ...coefficients,
      };
      for (const [frame, name] of [
        [normalized.start_frame, "start_HPY"],
        [normalized.end_frame, "target_HPY"],
      ] as const) {
        const evaluated = evaluatePiece(normalized, frame).positions;
        if (!evaluated.every(Number.isFinite)) throw new Error("系数阶段端点计算超出浮点范围");
        const given = piece[name];
        if (given !== undefined && !closeTo(evaluated, hpyOf(given, name))) {
          throw new Error("系数阶段端点与位置字段不一致");
        }
        normalized[name] = evaluated;
      }
      const prior = flat[flat.length - 1];
      if (prior && !closeTo(prior.target_HPY, normalized.start_HPY)) {
        throw new Error("相邻系数阶段或原动作空档前后的位置不连续");
      }
      flat.push(normalized);
      cursor = pieceEnd;
    }
    if (cursor !== end) throw new Error("系数阶段没有覆盖到原动作末帧");
    for (const [value, name] of [
      [flat[firstIndex]!.start_HPY, "start_HPY"],
      [lastOf(flat).target_HPY, "target_HPY"],
    ] as const) {
      const given = segment[name];
      if (given !== undefined && !closeTo(value, hpyOf(given, name))) {
        throw new Error("原动作端点与abcdef/系数阶段不一致");
      }
    }
  }
  return { pieces: flat, boundaries: [...boundaries].sort((left, right) => left - right) };
};

/** _normalize_inputs：建立内部编号，几何类型与业务类型在入口转换 */
const normalizeInputs = (parameters: NearestParameters): EntryInputs => {
  if (typeof parameters !== "object" || parameters === null) throw new Error("parameters必须是对象");
  const command = parameters.command;
  const settings = parameters.settings ?? {};
  if (typeof command !== "object" || command === null || typeof settings !== "object") {
    throw new Error("command/settings必须是对象");
  }
  if (typeof command.trajectory_run !== "boolean") {
    throw new Error("command.trajectory_run必须明确为true或false");
  }
  const flag = (name: string, fallback: boolean): boolean => {
    const value = name in command ? command[name] : fallback;
    if (typeof value !== "boolean") throw new Error(`command.${name}必须为bool`);
    return value;
  };
  const reverse = flag("reverse", false);
  const loopOnceFlag = flag("loop_once", true);
  const nearestStart = flag("nearest_start", true);
  const useSpecifiedTime = flag("use_specified_time", false);
  // 显式循环数为准；未提供时兼容 loop_once，true=1，false=0（PLC 无限循环）
  const loopCount = "loop_count" in command ? command.loop_count : loopOnceFlag ? 1 : 0;
  if (!isInteger(loopCount) || loopCount < 0 || loopCount > 65535) {
    throw new Error("command.loop_count必须是0到65535的整数");
  }
  const specified = "specified_time_ms" in command ? command.specified_time_ms : 0;
  const stopped = command.stopped_time_ms ?? null;
  for (const [name, value] of [
    ["specified_time_ms", specified],
    ["stopped_time_ms", stopped],
  ] as const) {
    if (value === null && name === "stopped_time_ms") continue;
    if (!isInteger(value) || value < 0 || value > UINT32_MAX) {
      throw new Error(`command.${name}必须是uint32整数毫秒，停止帧可为null`);
    }
  }
  const scheme = settings.model_type_scheme ?? "business";
  if (scheme !== "business" && scheme !== "geometry") {
    throw new Error("settings.model_type_scheme只能是business或geometry");
  }
  const unit = curveTimeUnitOf(settings);
  const coarse = finiteNumber("coarse_step_ms" in settings ? settings.coarse_step_ms : 100, "coarse_step_ms");
  const fine = finiteNumber("fine_step_ms" in settings ? settings.fine_step_ms : 10, "fine_step_ms");
  if (
    Math.min(unit, coarse, fine) <= 0 ||
    !Number.isInteger(coarse) ||
    !Number.isInteger(fine) ||
    fine > coarse
  ) {
    throw new Error("系数时间单位须>0；搜索步长须为整数ms且0<细步长<=粗步长");
  }
  const states = runtimeStatesOf(parameters);

  const models: EntryModel[] = [];
  const seen = new Set<string>();
  const deviceRoutes = new Set<string>();
  parameters.models.forEach((original, offset) => {
    const index = offset + 1;
    const plcId = original.plc_id;
    const modelId = original.model_id;
    const deviceId = original.device_id ?? modelId;
    if (typeof plcId !== "string" || plcId.trim() === "") throw new Error("每模型plc_id必须是非空字符串");
    if (!isInteger(modelId) || modelId < 0) throw new Error("model_id必须是非负整数；不同PLC可以重号");
    if (!isInteger(deviceId) || deviceId < 1 || deviceId > 65535) {
      throw new Error("device_id必须为1到65535的整数，与PLC协议一致");
    }
    const modelKey = JSON.stringify([plcId, modelId]);
    const deviceKey = JSON.stringify([plcId, deviceId]);
    if (seen.has(modelKey) || deviceRoutes.has(deviceKey)) {
      throw new Error("同一PLC中的model_id/device_id不能重复");
    }
    seen.add(modelKey);
    deviceRoutes.add(deviceKey);

    const businessKind = original.model_type;
    if (!isInteger(businessKind)) throw new Error("model_type必须为整数");
    let kind: GeometryKind;
    if (scheme === "business") {
      const mapped = GEOMETRY_KIND_BY_BUSINESS[businessKind];
      if (!mapped) throw new Error("业务模型类型仅支持2单点、6两点、7四点、8多点");
      kind = mapped;
    } else {
      if (![1, 2, 4, 8].includes(businessKind)) throw new Error("几何模型类型仅支持1、2、4、8");
      kind = businessKind as GeometryKind;
    }
    const geometry: EntryModel["geometry"] = {};
    for (const name of GEOMETRY_NUMBER_FIELDS) {
      if (original[name] !== undefined) geometry[name] = finiteNumber(original[name], name);
    }
    let pointInitPos: Hpy[] | undefined;
    if (original.point_init_pos !== undefined) {
      if (!Array.isArray(original.point_init_pos)) throw new Error("point_init_pos必须是XYZ吊点列表");
      pointInitPos = original.point_init_pos.map((point) => hpyOf(point, "point_init_pos XYZ"));
    }
    const motorNum = original.motor_num ?? (kind === 8 ? (pointInitPos?.length ?? 0) : kind);
    if (!isInteger(motorNum) || motorNum <= 0) throw new Error("motor_num必须为正整数");

    const state = states.get(modelId)!;
    const current = hpyOf(state.position_HPY, "current_HPY");
    if (state.standstill === false) {
      throw new Error(`${plcId}/${modelId}尚未停稳，不能用零速准备规划`);
    }
    const currentVelocity = hpyOf(state.velocity_HPY, "current_velocity_HPY");
    if (currentVelocity.some((value) => Math.abs(value) > 1e-7)) {
      throw new Error(`${plcId}/${modelId}当前速度非零，请停稳后准备`);
    }
    const follow = axesOf(original.follow_axes ?? original.active_axes, "follow_axes");
    const prepare = axesOf(original.prepare_axes ?? follow, "prepare_axes");
    const supported = SUPPORTED_AXES[kind];
    if (!follow.every((axis) => prepare.includes(axis)) || !prepare.every((axis) => supported.includes(axis))) {
      throw new Error("prepare_axes须包含follow_axes，且不得加入模型不存在的轴");
    }
    if (kind === 4 && prepare.includes("P") && prepare.includes("Y")) {
      throw new Error("当前四点正解只支持单一倾斜方向，不能同时准备P/Y");
    }
    const defaults: VadHpy = {
      velocity: hpyOf(original.default_velocity_HPY, "default_velocity_HPY", true),
      acceleration: hpyOf(original.default_acceleration_HPY, "default_acceleration_HPY", true),
      deceleration: hpyOf(original.default_deceleration_HPY, "default_deceleration_HPY", true),
    };
    const max: VadHpy = {
      velocity: hpyOf(original.max_velocity_HPY, "max_velocity_HPY", true),
      acceleration: hpyOf(original.max_acceleration_HPY, "max_acceleration_HPY", true),
      deceleration: hpyOf(original.max_deceleration_HPY, "max_deceleration_HPY", true),
    };
    for (const name of prepare) {
      const axis = axisIndex(name);
      for (const field of ["velocity", "acceleration", "deceleration"] as const) {
        if (defaults[field][axis] > max[field][axis]) throw new Error("默认准备V/A/D不能超过对应最大值");
      }
    }
    const maxMotorVelocity = finiteNumber(original.max_motor_velocity, "max_motor_velocity");
    if (maxMotorVelocity <= 0) throw new Error("max_motor_velocity必须大于0");

    const { pieces, boundaries } = flattenSegments(original, unit);
    // 非 follow 轴整条曲线必须固定；系数很小也可能在长段累积成位移，按全段变化上界判断
    for (let axis = 0; axis < 3; axis += 1) {
      if (follow.includes(AXIS_NAMES[axis]!)) continue;
      const fixed = pieces[0]!.start_HPY[axis]!;
      for (const piece of pieces) {
        const uEnd = (piece.end_frame - piece.start_frame) / 100;
        let variation = 0;
        COEFFICIENT_NAMES.slice(1).forEach((name, offset) => {
          variation += Math.abs(piece[name][axis]!) * uEnd ** (offset + 1);
        });
        if (!Number.isFinite(variation) || Math.abs(piece.a[axis]! - fixed) + variation > 1e-5) {
          throw new Error("非follow_axes轴的原曲线必须固定，不能漏填活动轴");
        }
      }
    }

    models.push({
      index,
      route: { plc_id: plcId, model_id: modelId, device_id: deviceId, model_type: businessKind },
      kind,
      motorNum,
      pieces,
      pieceStarts: pieces.map((piece) => piece.start_frame),
      boundaries,
      supported,
      maxMotorVelocity,
      geometry,
      moveWhat: original.moveWhat,
      pointInitPos,
      current,
      prepare,
      follow,
      defaults,
      max,
    });
  });

  return {
    trajectoryRun: command.trajectory_run,
    direction: reverse ? -1 : 1,
    loopOnce: loopCount === 1,
    loopCount,
    nearestStart,
    useSpecifiedTime,
    specifiedTimeMs: specified as number,
    stoppedTimeMs: stopped as number | null,
    coarseStep: coarse,
    fineStep: fine,
    models,
  };
};

/** _map_prepare_frame：按 PLC 真实循环数映射公共帧；0 在 PLC 对应 10000000 次 */
const mapPrepareFrame = (
  globalFrame: number,
  first: number,
  last: number,
  direction: 1 | -1,
  loopCount: number,
): number => {
  if (loopCount === 1) return globalFrame;
  const period = last - first;
  const actualCount = loopCount === 0 ? 10000000 : loopCount;
  if (direction > 0) {
    if (globalFrame <= first) return first;
    if (globalFrame >= first + period * actualCount) return last;
  } else {
    if (globalFrame >= last) return last;
    // PLC 反向结束边界使用严格小于
    if (globalFrame < last - period * actualCount) return first;
  }
  // PLC getPosAllLoop 先移除完整周期，再在当前周期求值；整周期点回到首帧
  return first + pythonMod(globalFrame - first, period);
};

/** 强制 evaluate_model：首帧前取起点、末帧后取终点，空档保持上一段末值 */
const forcedTargetAt = (model: EntryModel, globalFrame: number, inputs: EntryInputs): Hpy => {
  const first = model.pieces[0]!;
  const last = lastOf(model.pieces);
  const frame = mapPrepareFrame(globalFrame, first.start_frame, last.end_frame, inputs.direction, inputs.loopCount);
  if (frame <= first.start_frame) return [...first.start_HPY];
  if (frame >= last.end_frame) return [...last.target_HPY];
  const piece = model.pieces[bisectRight(model.pieceStarts, frame) - 1]!;
  if (frame >= piece.end_frame) return [...piece.target_HPY];
  return evaluatePiece(piece, frame).positions;
};

/** 非强制 positions_at：段前保持初始位置，段间/段后保持最近一个已结束段的终点 */
const nonForcedTargetAt = (model: EntryModel, globalFrame: number, inputs: EntryInputs): Hpy => {
  const pieces = model.pieces;
  const frame = mapPrepareFrame(
    globalFrame,
    pieces[0]!.start_frame,
    lastOf(pieces).end_frame,
    inputs.direction,
    inputs.loopCount,
  );
  const index = bisectRight(model.pieceStarts, frame) - 1;
  let target: Hpy = [...pieces[0]!.start_HPY];
  if (index >= 0) {
    const piece = pieces[index]!;
    target = frame >= piece.end_frame ? [...piece.target_HPY] : evaluatePiece(piece, frame).positions;
  }
  if (!target.every(Number.isFinite)) {
    throw new Error(`模型${model.route.model_id}在${globalFrame}ms的位置计算非有限`);
  }
  return target;
};

/** 全组最大 |目标-当前|/速度；静止轴代价为 0，需要位移但速度为 0 时为无穷 */
const axisCost = (delta: number, velocity: number): number =>
  delta <= 1e-12 ? 0 : velocity > 0 ? delta / velocity : Number.POSITIVE_INFINITY;

const BINOMIAL: readonly (readonly number[])[] = [
  [1],
  [1, 1],
  [1, 2, 1],
  [1, 3, 3, 1],
  [1, 4, 6, 4, 1],
  [1, 5, 10, 10, 5, 1],
];

/**
 * _forced_polynomial_position_bounds：0~5 次位置多项式在 u∈[uStart, uEnd] 上的保守外包，
 * 不拿两端采样冒充整段范围；三次以上换成 Bernstein 控制值。外包放宽到覆盖求值舍入，溢出时不剪枝。
 */
const polynomialPositionBounds = (
  coefficients: readonly number[],
  uStart: number,
  uEnd: number,
): [number, number] => {
  const terms = [...coefficients];
  while (terms.length > 1 && terms[terms.length - 1] === 0) terms.pop();
  const degree = terms.length - 1;
  const left = Math.min(uStart, uEnd);
  const right = Math.max(uStart, uEnd);
  try {
    const value = (u: number): number => {
      let result = 0;
      for (let index = terms.length - 1; index >= 0; index -= 1) result = result * u + terms[index]!;
      return result;
    };
    let values: number[];
    let scale: number;
    if (degree <= 2) {
      values = [value(left), value(right)];
      if (degree === 2 && terms[2] !== 0) {
        const vertex = -terms[1]! / (2 * terms[2]!);
        if (left < vertex && vertex < right) values.push(value(vertex));
      }
      scale = Math.max(1, ...values.map(Math.abs));
    } else {
      // u = left + (right-left)·x 换到 x∈[0,1]，再转成 Bernstein 控制值
      const width = right - left;
      const power = Array.from({ length: degree + 1 }, (_, k) =>
        fsum(
          Array.from({ length: degree - k + 1 }, (__, offset) => {
            const j = k + offset;
            return terms[j]! * BINOMIAL[j]![k]! * left ** (j - k) * width ** k;
          }),
        ),
      );
      values = Array.from({ length: degree + 1 }, (_, i) =>
        fsum(Array.from({ length: i + 1 }, (__, k) => (power[k]! * BINOMIAL[i]![k]!) / BINOMIAL[degree]![k]!)),
      );
      scale = Math.max(1, fsum(power.map(Math.abs)), ...values.map(Math.abs));
    }
    // 平移前的大项也可能相消：外包要覆盖原求值过程的舍入误差
    const radius = Math.max(Math.abs(left), Math.abs(right));
    scale = Math.max(scale, fsum(terms.map((coefficient, power) => Math.abs(coefficient) * radius ** power)));
    if (!Number.isFinite(scale) || !values.every(Number.isFinite)) {
      return [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
    }
    const pad = Math.max(1e-12, 128 * ulp(scale));
    return [
      nextAfter(Math.min(...values) - pad, Number.NEGATIVE_INFINITY),
      nextAfter(Math.max(...values) + pad, Number.POSITIVE_INFINITY),
    ];
  } catch {
    // 外包溢出只放弃这次剪枝，不能误排除可能更近的区间
    return [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  }
};

/** heapq：按元组逐项比较的最小堆 */
const tupleHeap = <T extends readonly number[]>() => {
  const items: T[] = [];
  const less = (left: T, right: T): boolean => {
    for (let index = 0; index < left.length; index += 1) {
      if (left[index]! < right[index]!) return true;
      if (left[index]! > right[index]!) return false;
    }
    return false;
  };
  const swap = (left: number, right: number) => {
    [items[left], items[right]] = [items[right]!, items[left]!];
  };
  return {
    get size() {
      return items.length;
    },
    peek: (): T | undefined => items[0],
    push: (item: T) => {
      items.push(item);
      let index = items.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (!less(items[index]!, items[parent]!)) break;
        swap(index, parent);
        index = parent;
      }
    },
    pop: (): T | undefined => {
      const top = items[0];
      const last = items.pop();
      if (items.length > 0 && last !== undefined) {
        items[0] = last;
        let index = 0;
        for (;;) {
          const left = index * 2 + 1;
          const right = left + 1;
          let smallest = index;
          if (left < items.length && less(items[left]!, items[smallest]!)) smallest = left;
          if (right < items.length && less(items[right]!, items[smallest]!)) smallest = right;
          if (smallest === index) break;
          swap(index, smallest);
          index = smallest;
        }
      }
      return top;
    },
  };
};

/** 实际选帧方式与范围，说明输入帧没有被直接当成目标 */
type FrameSelection = {
  mode: NearestEntryFrameSelectionMode;
  referenceFrameMs: number | null;
  searchOriginMs: number;
  searchRange: [number, number];
  statistics?: NearestSearchStatistics;
};

type SelectedFrame = {
  frame: number;
  targets: Map<number, Hpy>;
  startMode: NearestEntryStartMode;
  selection: FrameSelection;
};

/**
 * calculate_forced_nearest_position：指定帧优先，直接在该帧接入；非就近取动作边界；
 * 就近以停止帧为方向边界（正向 [停止帧, 末帧]，反向 [首帧, 停止帧]，不给停止帧时从方向边界搜全程），
 * 按归一化位置差评分：粗搜给出上界，再用位置包络分支定界覆盖整个方向细网格；
 * 数值等价的同位置取运行方向上先遇到的帧（往返曲线不会跳到回程），区间终点也参与比较。
 */
const selectForcedFrame = (inputs: EntryInputs): SelectedFrame => {
  const { models, direction } = inputs;
  const globalStart = Math.min(...models.map((model) => model.pieces[0]!.start_frame));
  const globalEnd = Math.max(...models.map((model) => lastOf(model.pieces).end_frame));
  const targetsAt = (frame: number) =>
    new Map(models.map((model) => [model.index, forcedTargetAt(model, frame, inputs)]));

  if (inputs.useSpecifiedTime) {
    const specified = inputs.specifiedTimeMs;
    if (!Number.isInteger(specified) || specified < globalStart || specified > globalEnd) {
      throw new Error(`specified_time_ms必须在${globalStart}到${globalEnd}之间且为整数毫秒`);
    }
    return {
      frame: specified,
      targets: targetsAt(specified),
      startMode: "nearest",
      selection: {
        mode: "specified_frame",
        referenceFrameMs: specified,
        searchOriginMs: specified,
        searchRange: [specified, specified],
      },
    };
  }
  if (!inputs.nearestStart) {
    const frame = direction > 0 ? globalStart : globalEnd;
    return {
      frame,
      targets: targetsAt(frame),
      startMode: "action_boundary",
      selection: { mode: "action_boundary", referenceFrameMs: null, searchOriginMs: frame, searchRange: [frame, frame] },
    };
  }

  const stopped = inputs.stoppedTimeMs;
  if (stopped !== null && (!Number.isInteger(stopped) || stopped < globalStart || stopped > globalEnd)) {
    throw new Error("stopped_time_ms必须是动作首末范围内的整数毫秒");
  }
  const origin = stopped ?? (direction > 0 ? globalStart : globalEnd);
  const [searchStart, searchEnd] = direction > 0 ? [origin, globalEnd] : [globalStart, origin];

  const statistics: NearestSearchStatistics = {
    method: "position_envelope_branch_and_bound",
    evaluated_frames: 0,
    bound_intervals: 0,
    pruned_grid_frames: 0,
    full_fine_grid_covered: true,
    fine_grid_frames: 0,
    normalized_position_tolerance: 0,
  };
  const axesByModel = new Map(models.map((model) => [model.index, model.prepare.map(axisIndex)]));
  const wholeModelBounds = new Map<number, Map<number, [number, number]>>();
  const polynomialBoundsCache = new Map<string, [number, number]>();

  /** 分段、空档保持和端点都纳入外包；循环跨出首末帧时保守地用整个模型的范围 */
  const modelPositionBounds = (
    model: EntryModel,
    leftFrame: number,
    rightFrame: number,
  ): Map<number, [number, number]> => {
    const pieces = model.pieces;
    const first = pieces[0]!.start_frame;
    const last = lastOf(pieces).end_frame;
    if (!inputs.loopOnce && (leftFrame < first || rightFrame > last)) return wholeModelBounds.get(model.index)!;
    const left = Math.max(first, Math.min(last, leftFrame));
    const right = Math.max(first, Math.min(last, rightFrame));
    const atLeft = forcedTargetAt(model, left, inputs);
    const atRight = forcedTargetAt(model, right, inputs);
    const axes = axesByModel.get(model.index)!;
    const result = new Map(
      axes.map((axis): [number, [number, number]] => [
        axis,
        [Math.min(atLeft[axis]!, atRight[axis]!), Math.max(atLeft[axis]!, atRight[axis]!)],
      ]),
    );
    for (let index = Math.max(0, bisectRight(model.pieceStarts, left) - 1); index < pieces.length; index += 1) {
      const piece = pieces[index]!;
      const start = piece.start_frame;
      const end = piece.end_frame;
      if (start > right) break;
      const lo = Math.max(left, start);
      const hi = Math.min(right, end);
      for (const axis of axes) {
        const bounds = result.get(axis)!;
        if (lo <= hi) {
          const coefficients = COEFFICIENT_NAMES.map((name) => piece[name][axis]!);
          const uStart = (lo - start) / CURVE_TICK_FRAME;
          const uEnd = (hi - start) / CURVE_TICK_FRAME;
          const key = `${coefficients.join(",")}|${uStart}|${uEnd}`;
          let cached = polynomialBoundsCache.get(key);
          if (cached === undefined) {
            cached = polynomialPositionBounds(coefficients, uStart, uEnd);
            polynomialBoundsCache.set(key, cached);
          }
          bounds[0] = Math.min(bounds[0], cached[0]);
          bounds[1] = Math.max(bounds[1], cached[1]);
        }
        // PLC 在首末帧、空档用明确的端点值，不能只包系数值
        for (const [frame, value] of [
          [start, piece.start_HPY[axis]!],
          [end, piece.target_HPY[axis]!],
        ] as const) {
          if (left <= frame && frame <= right) {
            bounds[0] = Math.min(bounds[0], value);
            bounds[1] = Math.max(bounds[1], value);
          }
        }
      }
    }
    return result;
  };

  // 只用来消掉多项式求值的数值尾差，不放宽现场位置 / 速度的执行容差
  let scoreTolerance = 0;
  for (const model of models) {
    const bounds = modelPositionBounds(model, model.pieces[0]!.start_frame, lastOf(model.pieces).end_frame);
    wholeModelBounds.set(model.index, bounds);
    for (const [axis, [lower, upper]] of bounds) {
      const current = model.current[axis]!;
      const velocity = model.max.velocity[axis]!;
      const finiteScale = [1, Math.abs(current), ...[lower, upper].filter(Number.isFinite).map(Math.abs)];
      const positionEpsilon = Math.max(1e-12, 32 * ulp(Math.max(...finiteScale)));
      if (velocity > 0) scoreTolerance = Math.max(scoreTolerance, positionEpsilon / velocity);
    }
  }

  // 位置差除以各轴最大速度统一 H/P/Y 量纲；同分还要算完剩余轴，不能把没算完的同分当成最近
  const scoreFrame = (frame: number, cutoff: number): number => {
    statistics.evaluated_frames += 1;
    let score = 0;
    for (const model of models) {
      const target = forcedTargetAt(model, frame, inputs);
      for (const name of model.prepare) {
        const axis = axisIndex(name);
        score = Math.max(
          score,
          axisCost(Math.abs(target[axis] - model.current[axis]), model.max.velocity[axis]),
        );
      }
      if (score > cutoff) break;
    }
    return score;
  };

  type Best = { frame: number; score: number };
  // 数值等价窗口固定围绕真正的最小代价，不逐次放宽；窗口内取运行方向上先遇到的帧
  let minimumScore = Number.POSITIVE_INFINITY;
  const equivalent = tupleHeap<[number, number, number]>();
  const consider = (frame: number): Best => {
    const score = scoreFrame(frame, minimumScore + scoreTolerance);
    minimumScore = Math.min(minimumScore, score);
    if (score <= minimumScore + scoreTolerance) equivalent.push([direction * frame, frame, score]);
    while (equivalent.size > 0 && equivalent.peek()![2] > minimumScore + scoreTolerance) equivalent.pop();
    const [, selectedFrame, selectedScore] = equivalent.peek()!;
    return { frame: selectedFrame, score: selectedScore };
  };

  const scan = (start: number, end: number, step: number): Best => {
    let current: Best | null = null;
    const epsilon = Math.abs(step) * 1e-9;
    let frame = start;
    while ((step > 0 && frame <= end + epsilon) || (step < 0 && frame >= end - epsilon)) {
      if (current !== null && minimumScore === 0 && direction * frame >= direction * current.frame) break;
      current = consider(frame);
      frame += step;
    }
    // 参考帧可能不与步长对齐：区间终点也要参与比较
    return consider(end);
  };

  const coarse = inputs.coarseStep;
  const fine = inputs.fineStep;
  // 粗搜只给出代价上界
  let best = direction > 0 ? scan(searchStart, searchEnd, coarse) : scan(searchEnd, searchStart, -coarse);

  // 整个允许方向的细网格都要比较或被位置包络安全排除，不能只细搜粗搜最优的一个盆地
  const gridOrigin = direction > 0 ? searchStart : searchEnd;
  const gridCount = Math.floor((searchEnd - searchStart) / fine + 1e-10) + 1;
  statistics.fine_grid_frames = gridCount;
  statistics.normalized_position_tolerance = scoreTolerance;
  const gridFrame = (index: number): number => gridOrigin + direction * index * fine;

  const intervalBound = (firstIndex: number, lastIndex: number): number => {
    statistics.bound_intervals += 1;
    const a = gridFrame(firstIndex);
    const b = gridFrame(lastIndex);
    let lowerScore = 0;
    for (const model of models) {
      for (const [axis, [lower, upper]] of modelPositionBounds(model, Math.min(a, b), Math.max(a, b))) {
        const current = model.current[axis]!;
        const delta = Math.max(0, lower - current, current - upper);
        lowerScore = Math.max(lowerScore, axisCost(delta, model.max.velocity[axis]!));
      }
    }
    return lowerScore;
  };

  /** 下界已超出等价窗口，或在当前最优之后且不可能改善真正最小代价的区间不用再看 */
  const competitive = (lower: number, firstIndex: number): boolean => {
    if (lower > minimumScore + scoreTolerance) return false;
    return !(
      direction * gridFrame(firstIndex) >= direction * best.frame &&
      (minimumScore === 0 || lower >= best.score)
    );
  };

  const pending = tupleHeap<[number, number, number]>();
  pending.push([intervalBound(0, gridCount - 1), 0, gridCount - 1]);
  while (pending.size > 0) {
    const [lower, firstIndex, lastIndex] = pending.pop()!;
    if (!competitive(lower, firstIndex)) {
      statistics.pruned_grid_frames += lastIndex - firstIndex + 1;
      continue;
    }
    if (lastIndex - firstIndex <= 7) {
      for (let index = firstIndex; index <= lastIndex; index += 1) best = consider(gridFrame(index));
      continue;
    }
    const middle = Math.floor((firstIndex + lastIndex) / 2);
    best = consider(gridFrame(middle));
    for (const [firstChild, lastChild] of [
      [firstIndex, middle - 1],
      [middle + 1, lastIndex],
    ] as const) {
      if (firstChild > lastChild) continue;
      const childLower = intervalBound(firstChild, lastChild);
      if (competitive(childLower, firstChild)) pending.push([childLower, firstChild, lastChild]);
      else statistics.pruned_grid_frames += lastChild - firstChild + 1;
    }
  }
  return {
    frame: best.frame,
    targets: targetsAt(best.frame),
    startMode: "nearest",
    selection: {
      mode: "directional_nearest",
      referenceFrameMs: stopped,
      searchOriginMs: origin,
      searchRange: [searchStart, searchEnd],
      statistics,
    },
  };
};

type Candidate = { frame: number; positions: Map<number, Hpy> };

/** calculate_non_forced_candidate_positions：沿运行方向的原关键帧，按最近程度依次给出 */
const nonForcedCandidates = (
  inputs: EntryInputs,
): {
  startMode: NearestEntryStartMode;
  candidates: Iterable<Candidate>;
  /** 实际搜索起点与沿方向允许的关键帧，只用于结果说明 */
  origin: number;
  allowed: number[];
} => {
  const { models, direction } = inputs;
  const stopped = inputs.stoppedTimeMs;
  const boundarySet = new Set<number>();
  for (const model of models) for (const frame of model.boundaries) boundarySet.add(frame);
  const boundaries = [...boundarySet].sort((left, right) => left - right);
  const globalStart = boundaries[0]!;
  const globalEnd = lastOf(boundaries);
  if (stopped !== null && stopped > globalEnd) {
    throw new Error(`stopped_time_ms必须在0到${globalEnd}之间`);
  }
  const positionsAt = (frame: number) =>
    new Map(models.map((model) => [model.index, nonForcedTargetAt(model, frame, inputs)]));

  if (!inputs.nearestStart) {
    const frame = direction > 0 ? globalStart : globalEnd;
    return {
      startMode: "action_boundary",
      candidates: [{ frame, positions: positionsAt(frame) }],
      origin: frame,
      allowed: [frame],
    };
  }

  // 未传停止帧时，所有模型一起搜索同一个曲线时间；关键帧也加入，避免漏掉短段
  let searchOrigin: number | null = stopped;
  if (searchOrigin === null) {
    let bestScore = Number.POSITIVE_INFINITY;
    const passes: Array<[number, number | null]> = [
      [inputs.coarseStep, null],
      [inputs.fineStep, inputs.coarseStep],
    ];
    for (const [step, radius] of passes) {
      const center: number | null = searchOrigin;
      const left: number = radius === null || center === null ? 0 : Math.max(0, center - radius);
      const right: number =
        radius === null || center === null ? globalEnd : Math.min(globalEnd, center + radius);
      const frames = new Set<number>([left, right]);
      for (const frame of boundaries) if (left <= frame && frame <= right) frames.add(frame);
      const count = Math.trunc((right - left) / step) + 1;
      for (let index = 0; index < count; index += 1) frames.add(left + index * step);
      const ordered: number[] = [...frames].sort((a, b) => (direction < 0 ? b - a : a - b));
      for (const frame of ordered) {
        const positions = positionsAt(frame);
        let score = 0;
        for (const model of models) {
          const target = positions.get(model.index)!;
          for (const name of model.prepare) {
            const axis = axisIndex(name);
            score = Math.max(
              score,
              axisCost(Math.abs(target[axis] - model.current[axis]), model.defaults.velocity[axis]),
            );
          }
        }
        if (score < bestScore) {
          bestScore = score;
          searchOrigin = frame;
        }
      }
      if (searchOrigin === null) {
        throw new Error("无法搜索最近曲线时间：正常速度为0或定位计算超出数值范围");
      }
    }
  }
  const origin = searchOrigin!;

  // 给定停止帧恰好在公共关键帧上时先用当前帧；否则沿方向取下一帧
  const givenFrameIsBoundary =
    stopped !== null && boundaries.some((frame) => Math.abs(frame - origin) <= 1e-9);
  let ordered = boundaries
    .filter((frame) => (frame - origin) * direction >= -1e-9)
    .filter((frame) => givenFrameIsBoundary || Math.abs(frame - origin) > 1e-9)
    .sort((a, b) => (direction < 0 ? b - a : a - b));
  if (ordered.length === 0) {
    const terminal = direction > 0 ? globalEnd : globalStart;
    if (Math.abs(origin - terminal) > 1e-9) throw new Error("当前方向没有候选关键帧，不选择反方向帧");
    ordered = [terminal];
  }

  const candidateScore = (frame: number, cutoff: number): number => {
    let score = 0;
    for (const model of models) {
      const target = nonForcedTargetAt(model, frame, inputs);
      for (const name of model.prepare) {
        const axis = axisIndex(name);
        score = Math.max(
          score,
          axisCost(Math.abs(target[axis] - model.current[axis]), model.defaults.velocity[axis]),
        );
      }
      // 后续模型只能增大 max 代价，不可能严格优于当前最优
      if (score >= cutoff) break;
    }
    return score;
  };

  /** 方向允许的关键帧中先选最近；不可执行时再选剩余帧里最近的 */
  function* nearestCandidates(): Generator<Candidate> {
    const remaining = [...ordered];
    while (remaining.length > 0) {
      let bestFrame: number | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const frame of remaining) {
        const score = candidateScore(frame, bestScore);
        if (bestFrame === null || score < bestScore) {
          bestFrame = frame;
          bestScore = score;
        }
        if (bestScore === 0) break;
      }
      if (!Number.isFinite(bestScore)) {
        throw new Error("最近关键帧评分无有效值：需要位移的准备轴默认速度不能为0");
      }
      yield { frame: bestFrame!, positions: positionsAt(bestFrame!) };
      remaining.splice(remaining.indexOf(bestFrame!), 1);
    }
  }

  return { startMode: "nearest", candidates: nearestCandidates(), origin, allowed: ordered };
};

/** _prepare_targets：非准备轴保持当前；可动固定轴不一致时要求显式加入准备 */
const prepareTargets = (inputs: EntryInputs, posSet: Map<number, Hpy>): Map<number, Hpy> => {
  const result = new Map<number, Hpy>();
  for (const model of inputs.models) {
    const target = [...posSet.get(model.index)!] as Hpy;
    AXIS_NAMES.forEach((name, axis) => {
      if (model.prepare.includes(name)) return;
      if (model.supported.includes(name) && Math.abs(target[axis] - model.current[axis]) > 1e-5) {
        throw new Error("固定姿态与当前不一致：须把该可动轴加入prepare_axes");
      }
      target[axis] = model.current[axis];
    });
    result.set(model.index, target);
  }
  return result;
};

/** 过渡路径上实际电机速度的保守上界；两点/四点/多点各自用几何导数上界 */
const motorUpperBound = (model: EntryModel, current: Hpy, target: Hpy, velocity: Hpy): number => {
  const id = model.route.model_id;
  const [vh, vp, vy] = velocity;
  let count: number;
  let bound: number;
  let endpoints: Array<readonly number[] | null>;
  if (model.kind === 1) {
    if (vp > 0 || vy > 0) throw new Error(`单点模型${id}只支持H轴位移`);
    count = model.motorNum;
    bound = vh;
    endpoints = [current, target].map((pose) => Array.from({ length: count }, () => pose[0]));
  } else {
    const [base1Name, base2Name] =
      model.kind === 8 ? (["Baseheight1", "Baseheight2"] as const) : (["BaseHight1", "BaseHight2"] as const);
    const fields: Array<keyof EntryModel["geometry"]> = [base1Name, base2Name, "maxheight"];
    if (model.kind === 8) fields.push("betainit");
    else fields.push("lLenth_inside", ...(model.kind === 4 ? (["wLenth_inside"] as const) : []));
    if (fields.some((name) => !Number.isFinite(model.geometry[name]))) {
      throw new Error(`模型${id}的几何参数缺失或非有限`);
    }
    const base1 = model.geometry[base1Name]!;
    const base2 = model.geometry[base2Name]!;
    const maxHeight = model.geometry.maxheight!;
    if (!((base1 > 0 && base2 === 0) || (base1 === 0 && base2 > 0)) || maxHeight <= 0) {
      throw new Error(`模型${id}必须恰有一个正基准高度，且maxheight大于0`);
    }
    if (model.kind === 2 || model.kind === 4) {
      const length = model.geometry.lLenth_inside!;
      const width = model.kind === 4 ? model.geometry.wLenth_inside! : length;
      if (Math.min(length, width) <= 0) throw new Error(`模型${id}吊点间距必须大于0`);
      let tiltAxis: 1 | 2 = 1;
      if (model.kind === 2) {
        if (vy > 0) throw new Error(`两点模型${id}不支持Y轴位移`);
        endpoints = [current, target].map((pose) =>
          twoPointForward(pose[0], pose[1], base1, base2, length, maxHeight),
        );
      } else {
        const pTilt = [current, target].some((pose) => Math.abs(pose[1]) > 1e-10);
        const yTilt = [current, target].some((pose) => Math.abs(pose[2]) > 1e-10);
        if (pTilt && yTilt) throw new Error(`四点模型${id}当前正解不支持P/Y混合倾斜过渡`);
        const inferred = pTilt ? 1 : yTilt ? 2 : 0;
        const moveWhat = model.moveWhat === undefined ? inferred : model.moveWhat;
        if (!isInteger(moveWhat) || ![0, 1, 2].includes(moveWhat)) {
          throw new Error("四点moveWhat只能为0、1、2");
        }
        if (inferred && moveWhat !== inferred) throw new Error("四点moveWhat与实际准备姿态方向不一致");
        if (
          (moveWhat === 1 && model.prepare.includes("Y")) ||
          (moveWhat === 2 && model.prepare.includes("P"))
        ) {
          throw new Error("四点prepare_axes与PLC的moveWhat方向不一致");
        }
        tiltAxis = moveWhat === 2 ? 2 : 1;
        endpoints = [current, target].map((pose) =>
          fourPointForward(pose[0], pose[1], pose[2], base1, base2, length, width, maxHeight, moveWhat),
        );
      }
      count = model.kind;
      if (model.motorNum !== count) throw new Error(`模型${id}的motor_num与模型类型不一致`);
      const halfSpan = (tiltAxis === 1 ? length : width) / 2;
      const angle = Math.max(Math.abs(current[tiltAxis]), Math.abs(target[tiltAxis]));
      const angularSpeed = tiltAxis === 1 ? vp : vy;
      bound = vh + (halfSpan * RAD + (3 * halfSpan * angle ** 2) / 90 ** 3) * angularSpeed;
    } else {
      const points = model.pointInitPos;
      if (!points || points.length < 3) throw new Error(`多点模型${id}需要至少三个有限XYZ吊点`);
      count = points.length;
      if (model.motorNum !== count) throw new Error(`模型${id}的motor_num与吊点数不一致`);
      const radius = Math.max(...points.map((point) => Math.hypot(point[0], point[1])));
      const uniqueXy = new Set(points.map((point) => `${point[0]},${point[1]}`));
      if (radius <= 1e-12 || uniqueXy.size !== count) throw new Error(`多点模型${id}吊点平面退化或重复`);
      let area = 0;
      points.forEach((p, index) => {
        const q = points[(index + 1) % count]!;
        area += p[0] * q[1] - p[1] * q[0];
      });
      const orientation = area > 0 ? 1 : -1;
      let minRadius = Number.POSITIVE_INFINITY;
      points.forEach((p, index) => {
        const q = points[(index + 1) % count]!;
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const edge = Math.hypot(dx, dy);
        const originDistance = (orientation * (p[0] * q[1] - p[1] * q[0])) / edge;
        const concave = points.some(
          (r) => orientation * (dx * (r[1] - p[1]) - dy * (r[0] - p[0])) < -radius * edge * 1e-10,
        );
        if (originDistance <= radius * 1e-10 || concave) {
          throw new Error(`多点模型${id}吊点必须组成包含原点的有序凸多边形`);
        }
        minRadius = Math.min(minRadius, originDistance);
      });
      const effectiveHeights = [current, target].map((pose) =>
        base1 > 0 ? pose[0] + base1 : base2 + maxHeight - pose[0],
      );
      if (Math.min(...effectiveHeights) < 0) throw new Error(`多点模型${id}过渡的有效高度不能为负`);
      const nMin = Math.min(100, 1.73 + (0.52 * Math.min(...effectiveHeights)) / radius);
      const nMax = Math.min(100, 1.73 + (0.52 * Math.max(...effectiveHeights)) / minRadius);
      // 旧正解不改；提前排除可能在路径中途令旧 pow 溢出的极端数值
      const maxPitchRad = Math.max(Math.abs(current[1]), Math.abs(target[1])) * RAD;
      if (Math.log(radius) + nMax * Math.max(0, Math.log(Math.max(maxPitchRad, 1e-300))) > 700) {
        throw new Error("多点角度/尺寸使旧正解的中途幂运算可能溢出");
      }
      const cH = 0.52 / (Math.E * nMin);
      const cP = (radius * nMax * RAD) / 1.5707963;
      const cR = 1 + (nMax - 1.73) / (Math.E * nMin);
      bound =
        (1 + cH) * vh +
        (radius * RAD + cP) * vp +
        (3 * radius + (cR * radius ** 2) / minRadius) * RAD * vy;
      const betaInit = model.geometry.betainit!;
      endpoints = [current, target].map((pose) =>
        solveMultiPointForward({
          height: pose[0],
          pitch: pose[1],
          roll: pose[2],
          pointInitPos: points as Vec3[],
          baseHeight1: base1,
          baseHeight2: base2,
          maxHeight,
          betaInit,
        }),
      );
    }
  }
  if (
    count <= 0 ||
    endpoints.some((values) => !values || values.length !== count || !values.every(Number.isFinite))
  ) {
    throw new Error(`模型${id}端点正解未返回有效电机位置`);
  }
  if (!Number.isFinite(bound) || bound < 0) throw new Error(`模型${id}的电机速度上界无效`);
  return bound;
};

type EntryMotion = {
  frame: number;
  startMode: NearestEntryStartMode;
  targets: Map<number, Hpy>;
  velSet: Map<number, VadHpy>;
  maxRunTimeSec: number;
  motorLimitScale: number;
  motorChecks: Map<number, { limit: number; upperBound: number }>;
};

/**
 * calculate_synchronized_entry_move：停稳后的零速起止 Move，HPY 不超限、移动轴同时到达；
 * 实轴速度上界超限时所有模型乘同一个 k，不能各自降速破坏同步。
 */
const synchronizedEntryMove = (
  inputs: EntryInputs,
  frame: number,
  startMode: NearestEntryStartMode,
  targets: Map<number, Hpy>,
): EntryMotion => {
  type AxisProfile = { distance: number; peak: number; time: number; acceleration: number; deceleration: number };
  const profiles = new Map<number, Map<number, AxisProfile>>();
  const minimumTimes: number[] = [];
  for (const model of inputs.models) {
    const id = model.route.model_id;
    const current = model.current;
    const target = targets.get(model.index)!;
    if (!target.every(Number.isFinite)) throw new Error(`模型${id}的起终点必须是有限H/P/Y三项`);
    const axes = model.prepare.map(axisIndex);
    for (let axis = 0; axis < 3; axis += 1) {
      if (!axes.includes(axis as 0 | 1 | 2) && Math.abs(target[axis]! - current[axis]!) > 1e-5) {
        throw new Error(`模型${id}的非活动轴无法到达此目标`);
      }
    }
    const axisProfiles = new Map<number, AxisProfile>();
    for (const axis of axes) {
      const distance = Math.abs(target[axis] - current[axis]);
      let acceleration = model.max.acceleration[axis];
      let deceleration = model.max.deceleration[axis];
      if (inputs.trajectoryRun) {
        // PLC 实际 D=A；最大 A/D 是各自上限，取较小值才能同时满足
        acceleration = Math.min(acceleration, deceleration);
        deceleration = acceleration;
      }
      if (distance > 1e-12 && !isClose(acceleration, deceleration, 1e-12)) {
        throw new Error("当前PLC准备Move要求A=D，不能按独立D规划后让PLC仍用A");
      }
      const { peak, time } = minimumMotionProfile(distance, model.max.velocity[axis], acceleration, deceleration);
      if (!Number.isFinite(peak) || !Number.isFinite(time)) throw new Error(`模型${id}的运动计算超出数值范围`);
      if (distance > 1e-12 && (peak <= 0 || time <= 0)) {
        throw new Error(`模型${id}的非零位移运动参数过小，超出数值范围`);
      }
      axisProfiles.set(axis, { distance, peak, time, acceleration, deceleration });
      minimumTimes.push(time);
    }
    profiles.set(model.index, axisProfiles);
  }

  // 按最慢轴的耗时同步；停留轴输出零参数
  let synchronizedTime = minimumTimes.reduce((max, time) => Math.max(max, time), 0);
  const velSet = new Map<number, VadHpy>();
  for (const model of inputs.models) {
    const params: VadHpy = { velocity: [0, 0, 0], acceleration: [0, 0, 0], deceleration: [0, 0, 0] };
    for (const [axis, profile] of profiles.get(model.index)!) {
      if (profile.distance <= 1e-12) continue;
      let vad: AxisVad = {
        velocity: profile.peak,
        acceleration: profile.acceleration,
        deceleration: profile.deceleration,
      };
      if (synchronizedTime > profile.time) {
        // 原来 2 秒、同步 5 秒：k=2/5，速度乘 k，加减速度乘 k²
        vad = scaleMotionParameters(vad, profile.time / synchronizedTime);
      }
      if (![vad.velocity, vad.acceleration, vad.deceleration].every((value) => Number.isFinite(value) && value > 0)) {
        throw new Error(`模型${model.route.model_id}同步后的移动轴V/A/D超出数值范围`);
      }
      params.velocity[axis] = vad.velocity;
      params.acceleration[axis] = vad.acceleration;
      params.deceleration[axis] = vad.deceleration;
    }
    velSet.set(model.index, params);
  }

  const motorChecks = new Map<number, { limit: number; upperBound: number }>();
  let motorScale = 1;
  for (const model of inputs.models) {
    const limit = model.maxMotorVelocity;
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error(`模型${model.route.model_id}的最大电机速度必须为有限正数`);
    }
    const bound = motorUpperBound(
      model,
      model.current,
      targets.get(model.index)!,
      velSet.get(model.index)!.velocity,
    );
    if (bound > 0) motorScale = Math.min(motorScale, limit / (bound * (1 + 1e-9)));
    motorChecks.set(model.index, { limit, upperBound: bound });
  }

  if (motorScale < 1) {
    for (const params of velSet.values()) {
      for (let axis = 0; axis < 3; axis += 1) {
        const scaled = scaleMotionParameters(
          {
            velocity: params.velocity[axis]!,
            acceleration: params.acceleration[axis]!,
            deceleration: params.deceleration[axis]!,
          },
          motorScale,
        );
        if (params.velocity[axis]! > 0 && Math.min(scaled.velocity, scaled.acceleration, scaled.deceleration) <= 0) {
          throw new Error("电机限速要求的参数过小，超出浮点可计算范围");
        }
        params.velocity[axis] = scaled.velocity;
        params.acceleration[axis] = scaled.acceleration;
        params.deceleration[axis] = scaled.deceleration;
      }
    }
    synchronizedTime /= motorScale;
    if (!Number.isFinite(synchronizedTime)) throw new Error("限速后的运行时间超出数值范围");
  }
  for (const check of motorChecks.values()) check.upperBound *= motorScale;

  return {
    frame,
    startMode,
    targets,
    velSet,
    maxRunTimeSec: synchronizedTime,
    motorLimitScale: motorScale,
    motorChecks,
  };
};

/**
 * calculate_nearest_entry（停稳同步准备）：输入公共 models + runtime，返回选帧、共同准备时间
 * 与各设备 V/A，1006 按 prepare_time_ms_ceil 与 velocity_HPY / acceleration_HPY 下发。不修改输入。
 */
export const calculateNearestEntry = (parameters: NearestParameters): NearestEntryResult => {
  const inputs = normalizeInputs(parameters);

  // 对齐 XML autoFunFB.start 的 canLoop：非闭合动作回退单次，全组统一
  const loopFallback: NearestEntryResult["loop_fallback"] = [];
  if (!inputs.loopOnce) {
    for (const model of inputs.models) {
      const first = model.pieces[0]!.start_HPY;
      const last = lastOf(model.pieces).target_HPY;
      for (const name of model.follow) {
        const axis = axisIndex(name);
        if (Math.abs(first[axis] - last[axis]) > 0.001) {
          loopFallback.push({
            plc_id: model.route.plc_id,
            model_id: model.route.model_id,
            axis: name,
            reason: "首尾位置不闭合，按XML规则改为单次",
          });
        }
      }
    }
    if (loopFallback.length > 0) {
      inputs.loopOnce = true;
      inputs.loopCount = 1;
    }
  }

  let motion: EntryMotion | null = null;
  let curveTargets = new Map<number, Hpy>();
  let selection: FrameSelection | null = null;
  const skipped: NearestEntryResult["skipped_candidates"] = [];
  if (inputs.trajectoryRun) {
    const selected = selectForcedFrame(inputs);
    selection = selected.selection;
    curveTargets = selected.targets;
    motion = synchronizedEntryMove(
      inputs,
      selected.frame,
      selected.startMode,
      prepareTargets(inputs, selected.targets),
    );
  } else {
    // 非强制指定帧只作搜索起点；仍沿方向接入原动作关键帧
    if (inputs.useSpecifiedTime) inputs.stoppedTimeMs = inputs.specifiedTimeMs;
    const { startMode, candidates, origin, allowed } = nonForcedCandidates(inputs);
    for (const candidate of candidates) {
      try {
        curveTargets = new Map([...candidate.positions].map(([key, value]) => [key, [...value] as Hpy]));
        motion = synchronizedEntryMove(
          inputs,
          candidate.frame,
          startMode,
          prepareTargets(inputs, candidate.positions),
        );
        break;
      } catch (error) {
        skipped.push({ frame_ms: candidate.frame, reason: errorMessage(error) });
      }
    }
    if (!motion) throw new Error(`沿当前方向没有可执行的共同关键帧：${JSON.stringify(skipped)}`);
    selection = {
      mode: inputs.nearestStart ? "directional_nearest" : "action_boundary",
      referenceFrameMs: inputs.stoppedTimeMs,
      searchOriginMs: origin,
      searchRange:
        allowed.length > 0
          ? [Math.min(...allowed), Math.max(...allowed)]
          : [motion.frame, motion.frame],
    };
  }

  // 1006 原帧须为整数，所有目标都按该整数帧求出
  const frame = motion.frame;
  if (!Number.isInteger(frame)) throw new Error("选中帧无法直接编码为整数ms，请使用整数搜索步长/原动作帧");
  const durationMs = motion.maxRunTimeSec * 1000;
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error("准备耗时换算成毫秒后超出浮点范围");
  // 共同等待只向上取整，不缩短原计算时间；全部静止时 0ms 合法
  const prepareTimeMsCeil = Math.ceil(durationMs);
  if (prepareTimeMsCeil > MAX_PREPARE_TIME_MS) throw new Error("共同准备时长超过uint32毫秒范围，不能编码到1006");

  const grouped = new Map<string, { plc_id: string; models: NearestEntryModelResult[] }>();
  for (const model of inputs.models) {
    const params = motion.velSet.get(model.index)!;
    const target = motion.targets.get(model.index)!;
    const check = motion.motorChecks.get(model.index)!;
    const execute = [0, 1, 2].map(
      (axis) => Math.abs(target[axis]! - model.current[axis]!) > 1e-12,
    ) as [boolean, boolean, boolean];
    const result: NearestEntryModelResult = {
      ...model.route,
      current_HPY: [...model.current],
      curve_target_HPY: [...curveTargets.get(model.index)!],
      target_HPY: [...target],
      velocity_HPY: [...params.velocity],
      acceleration_HPY: [...params.acceleration],
      deceleration_HPY: [...params.deceleration],
      execute_HPY: execute,
      expected_arrival_ms: execute.some(Boolean) ? durationMs : 0,
      motor_velocity_upper_bound: check.upperBound,
      max_motor_velocity: check.limit,
    };
    const group = grouped.get(model.route.plc_id) ?? { plc_id: model.route.plc_id, models: [] };
    group.models.push(result);
    grouped.set(model.route.plc_id, group);
  }
  const stationaryPlcIds = [...grouped.values()]
    .filter((group) => !group.models.some((model) => model.execute_HPY.some(Boolean)))
    .map((group) => group.plc_id);
  const requiresGroupWait = durationMs > 0 && stationaryPlcIds.length > 0;
  // 每台 PLC 收到相同的准备时长；目标仍由 PLC 按公共帧计算
  const payloads: NearestEntryPayload[] = [...grouped.values()].map((group) => ({
    plc_id: group.plc_id,
    selectedCurveTimeMs: frame,
    loopCount: inputs.loopCount,
    prepareTimeMs: prepareTimeMsCeil,
    devices: group.models.map((model) => ({
      deviceID: model.device_id,
      model_id: model.model_id,
      velocity_HPY: model.velocity_HPY,
      acceleration_HPY: model.acceleration_HPY,
      deceleration_HPY: model.deceleration_HPY,
      execute_HPY: model.execute_HPY,
    })),
  }));
  return {
    status: "planned",
    can_dispatch: true,
    message: requiresGroupWait
      ? "同步准备参数计算完成；整台静止PLC按共同结束时刻等待"
      : "全组同步准备参数计算完成",
    requires_group_wait: requiresGroupWait,
    trajectory_run: inputs.trajectoryRun,
    reverse: inputs.direction < 0,
    effective_loop_once: inputs.loopOnce,
    effective_loop_count: inputs.loopCount,
    loop_fallback: loopFallback,
    selected_curve_time_ms: frame,
    frame_selection_mode: selection.mode,
    frame_selection_version: FRAME_SELECTION_VERSION,
    reference_frame_ms: selection.referenceFrameMs,
    search_origin_frame_ms: selection.searchOriginMs,
    search_range_ms: selection.searchRange,
    selection_metric: "nearest_position",
    position_metric: "max(abs(target-current)/max_velocity_HPY)",
    search_statistics: selection.statistics ?? {},
    prepare_time_ms: durationMs,
    prepare_time_ms_ceil: prepareTimeMsCeil,
    start_mode: motion.startMode,
    motor_limit_scale: motion.motorLimitScale,
    stationary_plc_ids: stationaryPlcIds,
    all_stationary: durationMs === 0,
    devices: [...grouped.values()],
    "1006_payloads": payloads,
    skipped_candidates: skipped,
    algorithm_version: NEAREST_ALGORITHM_VERSION,
  };
};
