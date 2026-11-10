import {
  AXIS_NAMES,
  COEFFICIENT_NAMES,
  bisectLeft,
  bisectRight,
  pythonRound,
  pythonRoundInt,
  pythonSum,
  ulp,
  type AxisName,
  type CoefficientName,
} from "./algorithm-params";
import { runMoveCommands, type AxisMoveCommand, type AxisMoveRun } from "./move-commands";

/**
 * 非强制就近接入：python/非强制就近接入.py 的逐函数移植（入口 calculate_nonforced_entry）。
 *
 * 每台设备 H/P/Y 各一条准备 Move，GO 时一起下发（一条三轴准备 Move），接入帧时位置和有符号速度
 * 都与帧表回放一致，之后照原帧表运行。帧表从 models 的曲线系数按 move-commands 的规则还原。
 * 有停止参考帧时只搜当前原段和运行方向后续段，接入帧最多比参考帧靠后 entry_max_skip_ms。
 *
 * 结果必须与 Python 逐条一致：表达式保持 Python 的运算顺序，round / sum / 取整用 Python 规则
 * （pythonRound、pythonSum、pythonRoundInt）。Python 改了就照 diff 改这里，再跑 nonforced-entry.spec 对数。
 */

export const NONFORCED_ALGORITHM_VERSION = "nonforced_single_move_join_20261110_fast_5s_skip_limit";

type AxisIndex = 0 | 1 | 2;

const AXES: readonly AxisIndex[] = [0, 1, 2];

const EPS = 1e-9;
// 与 adjust_speed.py 的 _profile 判定“刹不住”的容差一致
const PROFILE_TOL = 1e-6;
// 曲线上判定“速度为 0 / 衔接处在动”的速度容差
const MOTION_SPEED_EPS = 1e-6;
// 内部编码回放误差容差
const ENTRY_MATCH_VELOCITY_TOLERANCE = 0.05;
const RATE_LIMIT = 6553.5;
const ARRIVAL_TOLERANCE_MS = 1.0;

export type NonforcedSettings = {
  entry_position_tolerance: number;
  entry_velocity_tolerance: number;
  entry_quantize_protocol: boolean;
  entry_send_time_decimals: number;
  entry_lead_tie_ms: number;
  entry_acceleration_source: "max" | "default";
  include_move_table: boolean;
  entry_max_skip_ms: number | null;
};

export const NONFORCED_DEFAULT_SETTINGS: NonforcedSettings = {
  entry_position_tolerance: 0.05,
  entry_velocity_tolerance: 1e-6,
  entry_quantize_protocol: true,
  entry_send_time_decimals: 3,
  entry_lead_tie_ms: 1,
  entry_acceleration_source: "max",
  include_move_table: false,
  entry_max_skip_ms: 3000,
};

type Settings = NonforcedSettings & { unit_ms: number; frame_resolution_ms: number };

// 每次计算独立计时，最多 5 秒
const CALCULATION_TIMEOUT_MS = 5000;
let deadline: number | null = null;

class EntryCalculationTimeout extends Error {}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

const checkDeadline = (): void => {
  if (deadline !== null && now() >= deadline) throw new EntryCalculationTimeout();
};

/** Python 的 ValueError / TypeError / KeyError：输入有误 */
class InvalidInput extends Error {}

/** 这个 t0 接不上；reasons 是每个轴的原因 */
class EntryInfeasible extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(reasons.join("；"));
    this.reasons = [...reasons];
  }
}

// ---------------------------------------------------------------------------
// 结果
// ---------------------------------------------------------------------------

export type EntryMove = { pos: number; vel: number; accVel: number; decVel: number };

export type NonforcedEntryMove = {
  plc_id: string;
  model_id: number;
  device_id: unknown;
  axis: AxisName;
  axisIndex: AxisIndex;
  role: "run_up" | "reposition";
  sendTime: number;
  beforeJoinMs: number;
} & EntryMove;

export type NonforcedAxisSummary = {
  axis: AxisName;
  kind: "in_place" | "run_up" | "reposition";
  lead_ms: number;
  distance?: number;
  run_up_distance?: number;
};

export type NonforcedDeviceRow = {
  plc_id: string;
  model_id: number;
  device_id: unknown;
  current_HPY: number[];
  join_HPY: (number | null)[];
  join_velocity_HPY: (number | null)[];
  axes: NonforcedAxisSummary[];
};

export type NonforcedFrameSelectionMode =
  | "specified_frame"
  | "action_boundary"
  | "current_segment_first"
  | "nearest_whole_action";

export type NonforcedSearchAttempt = {
  range_ms: [number, number];
  phase: "current_segment" | "directional_fallback" | "whole_action";
  status: "planned" | "infeasible" | "beyond_max_skip";
  searched_range_ms?: [number, number];
};

export type NonforcedPlannedResult = {
  status: "planned" | "verification_failed";
  message: string;
  algorithm_version: string;
  trajectory_run: false;
  reverse: boolean;
  selected_curve_time_ms: number;
  clock_start_ms: number;
  entry_lead_ms: number;
  frame_selection_mode: NonforcedFrameSelectionMode;
  reference_frame_ms: number | null;
  reference_clamped: boolean;
  reference_segment_range_ms: [number, number] | null;
  selected_segment_range_ms: [number, number] | null;
  segment_search_attempts: NonforcedSearchAttempt[];
  candidates_evaluated: number;
  max_skip_ms: number | null;
  entry_moves: NonforcedEntryMove[];
  devices: NonforcedDeviceRow[];
  execution: Record<string, string | number>;
  verification: { max_position_error: number; max_velocity_error: number; entry_monotonic: boolean; passed: boolean };
  move_table?: unknown[];
};

export type NonforcedInfeasibleResult = {
  status: "infeasible";
  message: string;
  algorithm_version: string;
  trajectory_run: false;
  reverse: boolean;
  frame_selection_mode: NonforcedFrameSelectionMode;
  reference_frame_ms: number | null;
  selected_curve_time_ms: null;
  segment_search_attempts: NonforcedSearchAttempt[];
  reasons: string[];
};

export type NonforcedInvalidResult = { status: "invalid_input"; message: string; algorithm_version: string };

export type NonforcedEntryResult = NonforcedPlannedResult | NonforcedInfeasibleResult | NonforcedInvalidResult;

// ---------------------------------------------------------------------------
// 一、基础：数值校验、取整、真实 Move 积分
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Python 真值：None / False / 0 / "" / 空列表为假 */
const truthy = (value: unknown): boolean =>
  !(
    value === undefined ||
    value === null ||
    value === false ||
    value === 0 ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );

const numberOf = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new InvalidInput(`${name}须为有限数值`);
  return value;
};

const tripleOf = (values: unknown, name: string, nonnegative = false): number[] => {
  if (!Array.isArray(values) || values.length !== 3) throw new InvalidInput(`${name}须为H/P/Y三个数`);
  const result = values.map((value, index) => numberOf(value, `${name}[${AXIS_NAMES[index]}]`));
  if (nonnegative && result.some((value) => value < 0)) throw new InvalidInput(`${name}不能为负数`);
  return result;
};

/** 协议 0.1 精度，半格远离 0 取整（与 adjust_speed.py 的 _quant 相同） */
export const quantize = (value: number): number => {
  const magnitude = Math.floor(Math.abs(value) * 10 + 0.5 + 1e-10) / 10;
  return value < 0 || Object.is(value, -0) ? -magnitude : magnitude;
};

type ProfilePhase = [seconds: number, position: number, velocity: number, acceleration: number];

/**
 * 无 Jerk 的真实 Move（与 adjust_speed.py 的 _profile 同一规则）：从 (q0, v0) 下发 (target, cap, acc, dec)，
 * 背向目标先减到 0；刹不住先停再折返；超速先降到 cap；然后提速、匀速、减速停在 target。
 */
export const moveProfile = (
  q0: number,
  v0: number,
  target: number,
  cap: number,
  acc: number,
  dec: number,
): ProfilePhase[] => {
  if (Math.min(cap, acc, dec) <= 0) throw new InvalidInput("有效Move的速度和加减速度须大于0");
  const phases: ProfilePhase[] = [];
  let q = q0;
  let v = v0;
  const run = (seconds: number, acceleration: number) => {
    if (seconds <= 1e-14) return;
    phases.push([seconds, q, v, acceleration]);
    q += v * seconds + 0.5 * acceleration * seconds * seconds;
    v += acceleration * seconds;
  };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let direction = target > q ? 1 : target < q ? -1 : 0;
    if (!direction) {
      if (Math.abs(v) <= PROFILE_TOL) return phases;
      direction = v > 0 ? 1 : -1;
    }
    let speed = direction * v;
    if (speed < -PROFILE_TOL) {
      run(-speed / dec, direction * dec);
      v = 0;
      speed = 0;
    }
    let distance = direction * (target - q);
    if (distance < (speed * speed) / (2 * dec) - PROFILE_TOL) {
      run(speed / dec, -direction * dec);
      v = 0;
      continue;
    }
    if (speed > cap + PROFILE_TOL) {
      run((speed - cap) / dec, -direction * dec);
      speed = cap;
      distance = direction * (target - q);
    }
    const peak = Math.min(
      cap,
      Math.sqrt(Math.max(0, (2 * acc * dec * distance + dec * speed * speed) / (acc + dec))),
    );
    if (peak < speed - PROFILE_TOL) {
      run(speed / dec, -direction * dec);
      v = 0;
      continue;
    }
    const accelerationDistance = Math.max(0, (peak * peak - speed * speed) / (2 * acc));
    const decelerationDistance = (peak * peak) / (2 * dec);
    run(Math.max(0, peak - speed) / acc, direction * acc);
    run(peak ? Math.max(0, distance - accelerationDistance - decelerationDistance) / peak : 0, 0);
    run(peak / dec, -direction * dec);
    return phases;
  }
  throw new InvalidInput("Move积分没有收敛");
};

const profileDuration = (phases: readonly ProfilePhase[]): number => pythonSum(phases.map((phase) => phase[0]));

// ---------------------------------------------------------------------------
// 二、从 models 的分段系数还原每个轴的运动阶段
// ---------------------------------------------------------------------------

type Coefficients = Record<CoefficientName, number[]>;
type Piece = [start: number, end: number, coefficients: Coefficients];

const piecesOf = (model: Json): Piece[] => {
  const segments = model.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new InvalidInput(`模型${String(model.model_id)}没有segments`);
  }
  const pieces: Piece[] = [];
  for (const segment of segments) {
    checkDeadline();
    if (!isRecord(segment)) throw new InvalidInput("segments元素须为对象");
    const items = truthy(segment.coefficient_segments) ? (segment.coefficient_segments as unknown[]) : [segment];
    for (const raw of items) {
      checkDeadline();
      const item = isRecord(raw) ? raw : {};
      const start = numberOf(item.start_frame, "start_frame");
      const end = numberOf(item.end_frame, "end_frame");
      if (end <= start) throw new InvalidInput(`模型${String(model.model_id)}的系数阶段时间无效`);
      if (!("a" in item)) throw new InvalidInput(`模型${String(model.model_id)}的系数阶段缺少a`);
      const coefficients = {} as Coefficients;
      for (const name of COEFFICIENT_NAMES) {
        coefficients[name] = name in item ? tripleOf(item[name], name) : [0, 0, 0];
      }
      if ((["d", "e", "f"] as const).some((name) => name in item && coefficients[name].some((value) => Math.abs(value) > 1e-12))) {
        throw new InvalidInput("非强制曲线须为恒加速度分段（d/e/f须为0）");
      }
      pieces.push([start, end, coefficients]);
    }
  }
  pieces.sort((left, right) => left[0] - right[0]);
  for (let index = 0; index + 1 < pieces.length; index += 1) {
    if (pieces[index + 1]![0] < pieces[index]![1] - 1e-6) {
      throw new InvalidInput(`模型${String(model.model_id)}的系数阶段重叠`);
    }
  }
  return pieces;
};

const pieceState = (piece: Piece, axis: number, frame: number, unitMs: number): [number, number] => {
  const [start, , coefficients] = piece;
  const u = (frame - start) / unitMs;
  const scale = 1000 / unitMs;
  const position = coefficients.a[axis]! + coefficients.b[axis]! * u + coefficients.c[axis]! * u * u;
  const velocity = (coefficients.b[axis]! + 2 * coefficients.c[axis]! * u) * scale;
  return [position, velocity];
};

type AxisPhase = { start: number; end: number; velocity: number; acceleration: number; position: number; pieces: Piece[] };

/** 一个轴的恒加速度阶段：被其它轴、关键帧切开的同一阶段合并回来，速度过零处分开 */
const axisPhases = (pieces: readonly Piece[], axis: number, unitMs: number): AxisPhase[] => {
  const scale = 1000 / unitMs;
  const phases: AxisPhase[] = [];
  for (const piece of pieces) {
    checkDeadline();
    const [start, end, coefficients] = piece;
    const velocity = coefficients.b[axis]! * scale;
    const acceleration = 2 * coefficients.c[axis]! * scale * scale;
    const last = phases[phases.length - 1];
    if (
      last !== undefined &&
      Math.abs(last.end - start) <= 1e-6 &&
      Math.abs(velocity) > MOTION_SPEED_EPS &&
      Math.abs(last.acceleration - acceleration) <= 1e-9 * Math.max(1, Math.abs(acceleration))
    ) {
      last.end = end;
      last.pieces.push(piece);
      continue;
    }
    phases.push({ start, end, velocity, acceleration, position: coefficients.a[axis]!, pieces: [piece] });
  }
  return phases;
};

/** 按停点切成连续运动；阶段速度为绝对值，衔接处速度不为 0 的相邻阶段属于同一段运动 */
const axisRuns = (pieces: readonly Piece[], axis: number, unitMs: number): AxisMoveRun[] => {
  const phases = axisPhases(pieces, axis, unitMs);
  type MutableRun = {
    phases: { startMs: number; endMs: number; fromSpeed: number; toSpeed: number }[];
    startPos: number;
    endPos: number;
    startSpeed: number;
    endSpeed: number;
  };
  const runs: MutableRun[] = [];
  let current: MutableRun | null = null;
  phases.forEach((phase, index) => {
    checkDeadline();
    const moving = Math.abs(phase.velocity) > MOTION_SPEED_EPS || Math.abs(phase.acceleration) > EPS;
    if (!moving) {
      current = null;
      return;
    }
    const following = phases[index + 1];
    const joined =
      following !== undefined &&
      Math.abs(following.end - following.start) > 0 &&
      Math.abs(following.start - phase.end) <= 1e-6 &&
      Math.abs(following.velocity) > MOTION_SPEED_EPS;
    const startSpeed = Math.abs(phase.velocity);
    let endSpeed: number;
    if (joined) {
      endSpeed = Math.abs(following.velocity);
    } else {
      const lastPiece = phase.pieces[phase.pieces.length - 1]!;
      endSpeed = Math.abs(pieceState(lastPiece, axis, lastPiece[1], unitMs)[1]);
      if (endSpeed <= MOTION_SPEED_EPS) endSpeed = 0;
    }
    if (current === null) {
      current = { phases: [], startPos: phase.position, endPos: 0, startSpeed, endSpeed: 0 };
      runs.push(current);
    }
    current.phases.push({ startMs: phase.start, endMs: phase.end, fromSpeed: startSpeed, toSpeed: endSpeed });
    const lastPiece = phase.pieces[phase.pieces.length - 1]!;
    current.endPos = pieceState(lastPiece, axis, lastPiece[1], unitMs)[0];
    current.endSpeed = endSpeed;
    if (!joined) current = null;
  });
  return runs;
};

// ---------------------------------------------------------------------------
// 四、帧表回放：按 C++ 的下发规则，把每个轴的 Move 积分成分段轨迹
// （三、Move 帧表复用 move-commands.ts 的 runMoveCommands）
// ---------------------------------------------------------------------------

/** 一段恒加速度运动；u0/u1 为运行方向上的毫秒，command 为当时生效的 Move（起步前为 null） */
export class Segment {
  constructor(
    readonly u0: number,
    readonly u1: number,
    readonly q0: number,
    readonly v0: number,
    readonly a: number,
    readonly command: EntryMove | null,
  ) {}

  state(u: number): [number, number] {
    if (!this.v0 && !this.a) return [this.q0, 0];
    const dt = (u - this.u0) / 1000;
    return [this.q0 + this.v0 * dt + 0.5 * this.a * dt * dt, this.v0 + this.a * dt];
  }
}

let trackSerial = 0;

/** 一个轴从 anchor 静止开始、依次执行 sends 得到的轨迹；sends = [u_ms, Move] 按 u 递增 */
export class AxisTrack {
  readonly serial = (trackSerial += 1);
  readonly sends: [number, EntryMove][];
  readonly sendTimes: number[];
  readonly segments: Segment[] = [];
  readonly starts: number[];

  constructor(
    readonly anchor: number,
    sends: readonly [number, EntryMove][],
  ) {
    this.sends = [...sends];
    this.sendTimes = this.sends.map(([u]) => u);
    let activeU = Number.NEGATIVE_INFINITY;
    let activePhases: ProfilePhase[] = [];
    let activeTarget = anchor;
    let activeCommand: EntryMove | null = null;
    for (const [u, command] of this.sends) {
      checkDeadline();
      const [q, v] = this.activeState(activeU, activePhases, activeTarget, u);
      this.emit(activeU, activePhases, activeTarget, activeCommand, u);
      activeU = u;
      activeTarget = command.pos;
      activeCommand = command;
      activePhases = moveProfile(q, v, command.pos, command.vel, command.accVel, command.decVel);
    }
    this.emit(activeU, activePhases, activeTarget, activeCommand, Number.POSITIVE_INFINITY);
    this.starts = this.segments.map((segment) => segment.u0);
  }

  private activeState(activeU: number, phases: readonly ProfilePhase[], target: number, u: number): [number, number] {
    if (activeU === Number.NEGATIVE_INFINITY) return [this.anchor, 0];
    let remaining = (u - activeU) / 1000;
    for (const [duration, q, v, a] of phases) {
      if (remaining <= duration) return [q + v * remaining + 0.5 * a * remaining * remaining, v + a * remaining];
      remaining -= duration;
    }
    return [target, 0];
  }

  private emit(
    activeU: number,
    phases: readonly ProfilePhase[],
    target: number,
    command: EntryMove | null,
    until: number,
  ): void {
    if (activeU === Number.NEGATIVE_INFINITY) {
      this.segments.push(new Segment(Number.NEGATIVE_INFINITY, until, this.anchor, 0, 0, null));
      return;
    }
    let u = activeU;
    for (const [duration, q, v, a] of phases) {
      const end = u + duration * 1000;
      if (u >= until) return;
      if (end > u) this.segments.push(new Segment(u, Math.min(end, until), q, v, a, command));
      u = end;
    }
    if (u < until) this.segments.push(new Segment(u, until, target, 0, 0, command));
  }

  segmentContaining(u: number): Segment {
    return this.segments[Math.max(0, bisectRight(this.starts, u) - 1)]!;
  }

  state(u: number): [number, number] {
    return this.segmentContaining(u).state(u);
  }

  boundaries(lower: number, upper: number): number[] {
    const first = Math.max(0, bisectRight(this.starts, lower) - 1);
    const last = bisectLeft(this.starts, upper);
    const values: number[] = [];
    for (const segment of this.segments.slice(first, last)) {
      for (const value of [segment.u0, segment.u1]) {
        if (lower < value && value < upper && Number.isFinite(value)) values.push(value);
      }
    }
    return values;
  }
}

// ---------------------------------------------------------------------------
// 五、输入整理（公共参数格式）
// ---------------------------------------------------------------------------

const settingsOf = (parameters: Json): Settings => {
  const raw = parameters.settings;
  const supplied: Json = truthy(raw) ? (raw as Json) : {};
  if (!isRecord(supplied)) throw new InvalidInput("settings须为对象");
  const settings = { ...NONFORCED_DEFAULT_SETTINGS } as Settings;
  for (const key of Object.keys(NONFORCED_DEFAULT_SETTINGS) as (keyof NonforcedSettings)[]) {
    if (key in supplied) (settings as Record<string, unknown>)[key] = supplied[key];
  }
  const unit =
    "forced_coefficient_time_unit_ms" in supplied
      ? supplied.forced_coefficient_time_unit_ms
      : "curve_time_unit_ms" in supplied
        ? supplied.curve_time_unit_ms
        : 100;
  settings.unit_ms = numberOf(unit, "forced_coefficient_time_unit_ms");
  const resolution = "nonforced_frame_step_ms" in supplied ? supplied.nonforced_frame_step_ms : 1;
  if (settings.unit_ms <= 0) throw new InvalidInput("系数时间单位须为正数");
  if (typeof resolution !== "number" || !Number.isInteger(resolution) || resolution <= 0) {
    throw new InvalidInput("nonforced_frame_step_ms须为正整数");
  }
  settings.frame_resolution_ms = resolution;
  for (const key of ["entry_position_tolerance", "entry_velocity_tolerance", "entry_lead_tie_ms"] as const) {
    if (numberOf(settings[key], key) < 0) throw new InvalidInput(`${key}不能为负数`);
  }
  for (const key of ["entry_quantize_protocol", "include_move_table"] as const) {
    if (typeof settings[key] !== "boolean") throw new InvalidInput(`${key}须为布尔值`);
  }
  if (settings.entry_acceleration_source !== "max" && settings.entry_acceleration_source !== "default") {
    throw new InvalidInput("entry_acceleration_source只能是max或default");
  }
  if (settings.entry_max_skip_ms !== null && numberOf(settings.entry_max_skip_ms, "entry_max_skip_ms") < 0) {
    throw new InvalidInput("entry_max_skip_ms不能为负数");
  }
  return settings;
};

type Command = {
  reverse: boolean;
  nearest_start: boolean;
  stopped_time_ms: number | null;
  use_specified_time: boolean;
  specified_time_ms: number | null;
  loop: boolean;
};

const commandOf = (parameters: Json): Command => {
  const command = parameters.command;
  if (!isRecord(command)) throw new InvalidInput("缺少command");
  if (command.trajectory_run === true) {
    throw new InvalidInput("强制轨迹请用 新就近算法/就近接入计算.py；本算法只处理非强制（trajectory_run=false）");
  }
  const reverse = "reverse" in command ? command.reverse : false;
  const nearest = "nearest_start" in command ? command.nearest_start : true;
  const specified = "use_specified_time" in command ? command.use_specified_time : false;
  if (typeof reverse !== "boolean" || typeof nearest !== "boolean" || typeof specified !== "boolean") {
    throw new InvalidInput("reverse、nearest_start、use_specified_time须为布尔值");
  }
  const stoppedRaw = command.stopped_time_ms;
  const stopped = stoppedRaw === undefined || stoppedRaw === null ? null : numberOf(stoppedRaw, "stopped_time_ms");
  const specifiedTime = specified ? numberOf(command.specified_time_ms, "specified_time_ms") : null;
  const loopCount = "loop_count" in command ? command.loop_count : 1;
  if (typeof loopCount !== "number" || !Number.isInteger(loopCount) || loopCount < 0) {
    throw new InvalidInput("loop_count须为非负整数（0为一直循环）");
  }
  return {
    reverse,
    nearest_start: nearest,
    stopped_time_ms: stopped,
    use_specified_time: specified,
    specified_time_ms: specifiedTime,
    loop: loopCount !== 1 && command.loop_once !== true,
  };
};

/** Python str()：None → "None" */
const pythonStr = (value: unknown): string => (value === null ? "None" : String(value));

const runtimeStates = (parameters: Json): Map<string, Json> => {
  const runtime = parameters.runtime;
  if (!isRecord(runtime) || !Array.isArray(runtime.models)) {
    throw new InvalidInput("缺少runtime.models（各模型当前位置）");
  }
  const states = new Map<string, Json>();
  for (const state of runtime.models) {
    checkDeadline();
    if (!isRecord(state) || typeof state.model_id !== "number" || !Number.isInteger(state.model_id)) {
      throw new InvalidInput("runtime.models[].model_id须为整数");
    }
    const plc = "plc_id" in state ? pythonStr(state.plc_id) : "";
    states.set(`${plc}\u0000${state.model_id}`, state);
    if (!states.has(`*\u0000${state.model_id}`)) states.set(`*\u0000${state.model_id}`, state);
  }
  return states;
};

const wireMove = (command: AxisMoveCommand, settings: Settings): EntryMove => {
  let move: EntryMove = {
    pos: command.target,
    vel: command.velocity,
    accVel: command.acceleration,
    decVel: command.deceleration,
  };
  if (settings.entry_quantize_protocol) {
    move = { pos: quantize(move.pos), vel: quantize(move.vel), accVel: quantize(move.accVel), decVel: quantize(move.decVel) };
  }
  if (Math.min(move.vel, move.accVel, move.decVel) <= 0) {
    throw new InvalidInput("曲线里有Move的V/A/D量化后为0（低于协议0.1精度）");
  }
  return move;
};

// 只缓存与反馈/能力/行程无关的原曲线编译结果；条数和阶段数双重受限（控制台长时间运行）
type CompiledCurve = { weight: number; commands: AxisMoveCommand[][]; tracks: AxisTrack[] };
const compiledCurves = new Map<string, CompiledCurve>();
let compiledCurvePieces = 0;
const COMPILED_CURVE_MAX_ENTRIES = 256;
const COMPILED_CURVE_MAX_PIECES = 100000;

const compiledCurve = (
  pieces: readonly Piece[],
  unit: number,
  direction: 1 | -1,
  runOrigin: number,
  loop: boolean,
  settings: Settings,
): [AxisMoveCommand[][], AxisTrack[]] => {
  checkDeadline();
  const signature = JSON.stringify([
    unit,
    direction,
    runOrigin,
    loop,
    settings.entry_quantize_protocol,
    pieces.map(([start, end, coefficients]) => [start, end, ...COEFFICIENT_NAMES.map((name) => coefficients[name])]),
  ]);
  checkDeadline();
  const cached = compiledCurves.get(signature);
  if (cached !== undefined) {
    compiledCurves.delete(signature);
    compiledCurves.set(signature, cached);
    return [cached.commands, cached.tracks];
  }
  const startPositions = AXES.map((axis) => pieceState(pieces[0]!, axis, pieces[0]![0], unit)[0]);
  const last = pieces[pieces.length - 1]!;
  const endPositions = AXES.map((axis) => pieceState(last, axis, last[1], unit)[0]);
  const allCommands: AxisMoveCommand[][] = [];
  const allTracks: AxisTrack[] = [];
  for (const axis of AXES) {
    checkDeadline();
    const commands = runMoveCommands(axisRuns(pieces, axis, unit), { reverse: direction < 0, loop });
    const ordered = direction < 0 ? [...commands].reverse() : commands;
    const sends = ordered.map((command): [number, EntryMove] => [
      direction * (command.atMs - runOrigin),
      wireMove(command, settings),
    ]);
    const anchor = direction < 0 ? endPositions[axis]! : startPositions[axis]!;
    allCommands.push(commands);
    allTracks.push(new AxisTrack(anchor, sends));
  }
  const weight = pieces.length;
  if (weight <= COMPILED_CURVE_MAX_PIECES) {
    compiledCurves.set(signature, { weight, commands: allCommands, tracks: allTracks });
    compiledCurvePieces += weight;
    while (compiledCurves.size > COMPILED_CURVE_MAX_ENTRIES || compiledCurvePieces > COMPILED_CURVE_MAX_PIECES) {
      const oldest = compiledCurves.keys().next().value as string;
      compiledCurvePieces -= compiledCurves.get(oldest)!.weight;
      compiledCurves.delete(oldest);
    }
  }
  return [allCommands, allTracks];
};

const floorRate = (value: number, quantized: boolean): number => {
  const capped = Math.min(value, RATE_LIMIT);
  return quantized ? Math.floor(capped * 10 + 1e-8) / 10 : capped;
};

/** Python format(round(v, 3), ".3f") 去掉末尾 0 */
const msText = (value: number): string => {
  const text = pythonRound(value, 3).toFixed(3);
  return text.replace(/0+$/, "").replace(/\.$/, "");
};

let deviceSerial = 0;

/** 一个模型：当前状态、能力参数、原动作段，以及按帧表回放出的各轴轨迹 */
class Device {
  readonly serial = (deviceSerial += 1);
  readonly modelId: number;
  readonly plcId: string;
  readonly deviceId: unknown;
  readonly current: number[];
  readonly active: boolean[];
  readonly entryAcceleration: number[];
  readonly repositionVelocity: number[];
  readonly repositionAcceleration: number[];
  readonly repositionDeceleration: number[];
  readonly lower: number[];
  readonly upper: number[];
  readonly prepareCaps: [number, number, number][];
  readonly axisLabels: string[];
  readonly currentInRange: boolean[];
  readonly restTailFailures = new Set<string>();
  readonly first: number;
  readonly last: number;
  readonly keyframes: number[];
  readonly commands: AxisMoveCommand[][];
  readonly tracks: AxisTrack[] = [];
  readonly moves: boolean;
  readonly tableLimitU: number[] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  readonly tableLimitReasons: (string | null)[] = [null, null, null];
  // 搜索过程中的启发式状态（Python 挂在 devices[0] / device 上的同名属性）
  entryFailureOrder?: string[];
  probeIndices?: number[];
  trajectoryErrorWitnesses?: [Map<string, Witness>, Map<string, Witness>, Map<string, Witness>];

  constructor(
    model: unknown,
    states: Map<string, Json>,
    direction: 1 | -1,
    runOrigin: number,
    loop: boolean,
    settings: Settings,
    pieces: Piece[],
  ) {
    if (!isRecord(model) || typeof model.model_id !== "number" || !Number.isInteger(model.model_id)) {
      throw new InvalidInput("models[].model_id须为整数");
    }
    this.modelId = model.model_id;
    this.plcId = "plc_id" in model ? pythonStr(model.plc_id) : "";
    this.deviceId = "device_id" in model ? model.device_id : this.modelId;
    const label = `模型${this.modelId}`;
    const state = states.get(`${this.plcId}\u0000${this.modelId}`) ?? states.get(`*\u0000${this.modelId}`);
    if (state === undefined) throw new InvalidInput(`runtime.models里缺少模型${this.modelId}的当前位置`);
    this.current = tripleOf(state.position_HPY, `${label} position_HPY`);
    const velocity = tripleOf("velocity_HPY" in state ? state.velocity_HPY : [0, 0, 0], `${label} velocity_HPY`);
    if (state.standstill === false || velocity.some((value) => Math.abs(value) > settings.entry_velocity_tolerance)) {
      throw new InvalidInput(`${label}还在运动，须停稳后再计算接入`);
    }
    const axesRaw = [model.prepare_axes, model.follow_axes, model.active_axes].find(truthy) ?? [...AXIS_NAMES];
    if (!Array.isArray(axesRaw) || axesRaw.some((name) => !(AXIS_NAMES as readonly unknown[]).includes(name))) {
      throw new InvalidInput(`${label}的prepare_axes只能是H/P/Y`);
    }
    this.active = AXIS_NAMES.map((name) => axesRaw.includes(name));
    // 准备统一按真实最大能力
    const floored = (values: number[]) =>
      settings.entry_quantize_protocol ? values.map((value) => Math.floor(value * 10 + 1e-8) / 10) : values;
    this.entryAcceleration = floored(tripleOf(model.max_acceleration_HPY, `${label} max_acceleration_HPY`, true));
    this.repositionVelocity = floored(tripleOf(model.max_velocity_HPY, `${label} max_velocity_HPY`, true));
    this.repositionAcceleration = floored(tripleOf(model.max_acceleration_HPY, `${label} max_acceleration_HPY`, true));
    this.repositionDeceleration = floored(
      tripleOf(
        "max_deceleration_HPY" in model ? model.max_deceleration_HPY : model.max_acceleration_HPY,
        `${label} max_deceleration_HPY`,
        true,
      ),
    );
    this.lower =
      "min_position_HPY" in model
        ? tripleOf(model.min_position_HPY, `${label} min_position_HPY`)
        : [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    this.upper =
      "max_position_HPY" in model
        ? tripleOf(model.max_position_HPY, `${label} max_position_HPY`)
        : [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const quantized = settings.entry_quantize_protocol;
    this.prepareCaps = AXES.map((index): [number, number, number] => [
      floorRate(this.repositionVelocity[index]!, quantized),
      floorRate(this.repositionAcceleration[index]!, quantized),
      floorRate(this.repositionDeceleration[index]!, quantized),
    ]);
    this.axisLabels = AXIS_NAMES.map((axis) => `模型${this.modelId} ${axis}`);
    this.currentInRange = AXES.map(
      (index) => this.lower[index]! - EPS <= this.current[index]! && this.current[index]! <= this.upper[index]! + EPS,
    );
    const unit = settings.unit_ms;
    this.first = pieces[0]![0];
    this.last = pieces[pieces.length - 1]![1];
    const frames = new Set<number>();
    for (const segment of model.segments as Json[]) {
      for (const name of ["start_frame", "end_frame"] as const) frames.add(numberOf(segment[name], name));
    }
    this.keyframes = [...frames].sort((left, right) => left - right);
    const [commands, compiledTracks] = compiledCurve(pieces, unit, direction, runOrigin, loop, settings);
    this.commands = commands;
    for (const axis of AXES) {
      let track = compiledTracks[axis]!;
      if (!this.active[axis] || (commands[axis]!.length === 0 && this.repositionVelocity[axis] === 0)) {
        if (commands[axis]!.length > 0) {
          throw new InvalidInput(`模型${this.modelId} ${AXIS_NAMES[axis]}有运动曲线却未列入准备轴`);
        }
        this.active[axis] = false;
        track = new AxisTrack(this.current[axis]!, []);
      }
      this.tracks.push(track);
    }
    this.moves = AXES.some((axis) => this.active[axis] && this.tracks[axis]!.sends.length > 0);
    // 帧表能力预检：接入后要执行的原表Move超能力/超行程时，与准备方式无关，verify 必然失败。
    // 记下每轴最后一条这样的Move（运行时刻），在它之前或同时的接入点直接判不可行。
    this.tracks.forEach((track, axis) => {
      for (const [u, command] of track.sends) {
        const problem = tableMoveProblem(command, this, axis as AxisIndex);
        if (problem !== null) {
          this.tableLimitU[axis] = u;
          this.tableLimitReasons[axis] = `原帧表${msText(runOrigin + direction * u)}ms处Move的${problem}`;
        }
      }
    });
  }
}

/** 原表Move是否必然通不过 verify 的指令检查；能力为 0 的轴在原地保持时另有放行，这里不判 */
const tableMoveProblem = (command: EntryMove, device: Device, index: AxisIndex): string | null => {
  if (!(device.lower[index]! - 1e-8 <= command.pos && command.pos <= device.upper[index]! + 1e-8)) {
    return `目标${msText(command.pos)}超出行程`;
  }
  if (!(-214748364.8 <= command.pos && command.pos <= 214748364.7)) return `目标${msText(command.pos)}超出协议范围`;
  const checks = [
    ["vel", device.repositionVelocity[index]!],
    ["accVel", device.repositionAcceleration[index]!],
    ["decVel", device.repositionDeceleration[index]!],
  ] as const;
  for (const [key, maximum] of checks) {
    if (command[key] > RATE_LIMIT + 1e-8) return `${key}=${msText(command[key])}超出协议上限${RATE_LIMIT}`;
    if (maximum > 0 && command[key] > maximum + 1e-8) {
      return `${key}=${msText(command[key])}超过最大能力${msText(maximum)}`;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// 六、单Move准备：只有共同起点一条指令，接入后自然沿原表运行
// ---------------------------------------------------------------------------

/** 距离相同时取较小值（与 Python 的 (abs(x-value), x) 排序一致） */
const ratesNear = (value: number, limit: number, settings: Settings, radius = 1): number[] => {
  if (!Number.isFinite(value) || value <= 0 || limit <= 0) return [];
  if (!settings.entry_quantize_protocol) return [Math.min(value, limit)];
  const center = quantize(value);
  const rates = new Set<number>();
  for (let k = -radius; k <= radius; k += 1) {
    const rate = center + k / 10;
    if (0.1 - 1e-9 <= rate && rate <= limit + 1e-8) rates.add(pythonRound(rate, 1));
  }
  return [...rates].sort((left, right) => Math.abs(left - value) - Math.abs(right - value) || left - right);
};

const targetOnWire = (value: number, device: Device, index: AxisIndex, settings: Settings): number => {
  if (!settings.entry_quantize_protocol) return value;
  let target = quantize(value);
  const lower = device.lower[index]!;
  const upper = device.upper[index]!;
  if (target < lower) target = Math.ceil(lower * 10 - 1e-8) / 10;
  if (target > upper) target = Math.floor(upper * 10 + 1e-8) / 10;
  return target;
};

const profileAt = (phases: readonly ProfilePhase[], target: number, seconds: number): [number, number] => {
  let remaining = seconds;
  for (const [duration, position, velocity, acceleration] of phases) {
    if (remaining <= duration) {
      return [
        position + velocity * remaining + 0.5 * acceleration * remaining * remaining,
        velocity + acceleration * remaining,
      ];
    }
    remaining -= duration;
  }
  return [target, 0];
};

type Family = "hold" | "rest" | "acceleration" | "cruise" | "endpoint" | "deceleration" | "transient_deceleration";

type AxisRequest = {
  device: Device;
  index: AxisIndex;
  u0: number;
  current: number;
  q: number;
  v: number;
  w: number;
  V: number;
  A: number;
  D: number;
  command: EntryMove | null;
  family: Family;
  minimum: number;
  maximum: number;
  L?: number;
  s?: 1 | -1;
  target?: number;
  dec?: number;
};

const axisRequest = (device: Device, index: AxisIndex, u0: number, settings: Settings): AxisRequest => {
  const track = device.tracks[index]!;
  const segment = track.segmentContaining(u0);
  const [q, v] = segment.state(u0);
  const current = device.current[index]!;
  const label = device.axisLabels[index]!;
  // verify 核对 u0 之后（含容差）的全部原表Move，这里用同一边界
  if (u0 <= device.tableLimitU[index]! + 1e-9) {
    throw new EntryInfeasible([`${label}${device.tableLimitReasons[index]}，只能在它之后接入`]);
  }
  if (!device.currentInRange[index]) throw new EntryInfeasible([`${label}当前位置超出行程`]);
  if (!(device.lower[index]! - EPS <= q && q <= device.upper[index]! + EPS)) {
    throw new EntryInfeasible([`${label}接入位置超出行程`]);
  }
  const quantized = settings.entry_quantize_protocol;
  const [V, A, D] = device.prepareCaps[index]!;
  const command = segment.command;
  const w = Math.abs(v);
  const request: AxisRequest = {
    device,
    index,
    u0,
    current,
    q,
    v,
    w,
    V,
    A,
    D,
    command,
    family: "hold",
    minimum: 0,
    maximum: Number.POSITIVE_INFINITY,
  };
  if (w <= settings.entry_velocity_tolerance) {
    request.v = 0;
    request.w = 0;
    if (Math.abs(current - q) <= settings.entry_position_tolerance && Math.abs(segment.a) <= 1e-10) {
      return request;
    }
  }
  if (Math.min(V, A, D) <= 0) throw new EntryInfeasible([`${label}需要运动，但可编码最大V/A/D为0`]);
  if (
    command !== null &&
    (command.vel > V + 1e-8 || command.accVel > A + 1e-8 || command.decVel > D + 1e-8)
  ) {
    throw new EntryInfeasible([`${label}原Move超过真实最大V/A/D，不能用默认值代替最大能力`]);
  }
  const sendIndex = bisectLeft(track.sendTimes, u0);
  const atOriginalSend =
    (sendIndex < track.sendTimes.length && Math.abs(track.sendTimes[sendIndex]! - u0) <= 1e-8) ||
    (sendIndex > 0 && Math.abs(track.sendTimes[sendIndex - 1]! - u0) <= 1e-8);
  if (!request.w) {
    if (Math.abs(segment.a) > 1e-10 && !atOriginalSend) {
      throw new EntryInfeasible([`${label}零速转折点不能由一条准备Move自然接续`]);
    }
    const target = targetOnWire(q, device, index, settings);
    const distance = Math.abs(target - current);
    if (distance <= 1e-12) return request;
    const minimum = profileDuration(moveProfile(current, 0, target, V, A, D));
    const smallest = quantized ? 0.1 : 1e-9;
    const maximum = profileDuration(moveProfile(current, 0, target, smallest, smallest, smallest));
    return { ...request, family: "rest", L: distance, target, minimum, maximum, s: target > current ? 1 : -1 };
  }
  const direction: 1 | -1 = v > 0 ? 1 : -1;
  const L = direction * (q - current);
  request.s = direction;
  request.L = L;
  if (w > V + 1e-8 || L < (w * w) / (2 * A) - 1e-9) {
    throw new EntryInfeasible([`${label}单Move距离或速度能力不足；不输出退回/途中覆盖`]);
  }
  const alpha = direction * segment.a;
  let family: Family;
  let dec: number;
  if (atOriginalSend) {
    family = "endpoint";
    dec = D;
  } else if (alpha > 1e-10) {
    if (Math.abs(L - (w * w) / (2 * alpha)) > settings.entry_position_tolerance + 1e-9) {
      throw new EntryInfeasible([`${label}加速段单Move无法自然贴合后续原加速度`]);
    }
    return {
      ...request,
      family: "acceleration",
      minimum: w / alpha,
      maximum: w / alpha,
      dec: command!.decVel,
      target: command!.pos,
    };
  } else if (Math.abs(alpha) <= 1e-10) {
    if (command === null || Math.abs(w - command.vel) > 1e-6) {
      throw new EntryInfeasible([`${label}当前状态不能按单Move匀速接续`]);
    }
    return {
      ...request,
      family: "cruise",
      minimum: L / w + w / (2 * A),
      maximum: (2 * L) / w,
      dec: command.decVel,
      target: command.pos,
    };
  } else {
    dec = Math.abs(segment.a);
    const natural = command !== null && Math.abs(direction * (command.pos - q) - (w * w) / (2 * dec)) <= 1e-5;
    if (natural) {
      family = "deceleration";
      request.target = command.pos;
    } else {
      const nextIndex = bisectRight(track.sendTimes, u0 + 1e-8);
      const nextSend = nextIndex < track.sendTimes.length ? track.sendTimes[nextIndex]! : Number.POSITIVE_INFINITY;
      if (nextSend > segment.u1 + 1e-8) {
        throw new EntryInfeasible([`${label}降到非零速度的减速段没有单Move自然接续方案`]);
      }
      family = "transient_deceleration";
      request.target = targetOnWire(q + (direction * w * w) / (2 * dec), device, index, settings);
    }
  }
  const peak = Math.min(V, Math.sqrt(Math.max(0, (2 * A * dec * L + A * w * w) / (A + dec))));
  if (peak < w - 1e-8) throw new EntryInfeasible([`${label}单Move峰值速度不足`]);
  const minimum = (L + (peak * peak) / (2 * A) + ((peak - w) * (peak - w)) / (2 * dec)) / peak;
  return { ...request, family, dec, minimum, maximum: (2 * L) / w };
};

/** Python 的 set → sorted：去重后升序 */
const sortedUnique = (values: Iterable<number>): number[] => [...new Set(values)].sort((left, right) => left - right);

function* candidateMoves(request: AxisRequest, seconds: number, settings: Settings): Generator<EntryMove> {
  const { family, device, index, V, A, D, q, current, w } = request;
  if (family === "hold") {
    // 无运动/不存在的虚轴也填真实位置，不能用pos=0当跳过标志
    yield {
      pos: targetOnWire(current, device, index, settings),
      vel: V || 0.1,
      accVel: A || 0.1,
      decVel: D || 0.1,
    };
    return;
  }
  if (family === "acceleration") {
    yield { ...request.command! };
    return;
  }
  if (seconds <= 0) return;
  if (family === "cruise") {
    const denominator = 2 * (w * seconds - request.L!);
    if (denominator > 0) {
      for (const acc of ratesNear((w * w) / denominator, A, settings, 2)) {
        yield { pos: request.target!, vel: w, accVel: acc, decVel: request.dec! };
      }
    }
    return;
  }
  if (family === "rest") {
    const distance = request.L!;
    const target = request.target!;
    const ratio = seconds / request.minimum;
    const fastest = Math.min(V, Math.sqrt((2 * A * D * distance) / (A + D)));
    for (const cap of ratesNear(fastest / ratio, V, settings, 1)) {
      for (const acc of ratesNear(A / (ratio * ratio), A, settings, 1)) {
        for (const dec of ratesNear(D / (ratio * ratio), D, settings, 1)) {
          yield { pos: target, vel: cap, accVel: acc, decVel: dec };
        }
      }
    }
    const harmonic = (seconds * seconds) / (2 * distance);
    const triangleAcc = [A, Math.min(A, (4 * distance) / (seconds * seconds)), Math.min(A, A / (ratio * ratio))];
    const low = Math.max(settings.entry_quantize_protocol ? 0.1 : 1e-9, 1 / Math.max(1e-15, harmonic - 1 / D));
    if (low <= A) {
      for (let k = 0; k < 33; k += 1) triangleAcc.push(low + ((A - low) * k) / 32);
    }
    for (const idealAcc of sortedUnique(triangleAcc)) {
      for (const acc of ratesNear(idealAcc, A, settings, 1)) {
        const remain = harmonic - 1 / acc;
        if (remain <= 0) continue;
        for (const dec of ratesNear(1 / remain, D, settings, 1)) {
          yield { pos: target, vel: V, accVel: acc, decVel: dec };
        }
      }
    }
    // 有匀速段的单Move：取编码A/D反求峰速，无中途发送
    const accelerations = sortedUnique([
      A,
      Math.min(A, Math.max(0.1, A / (ratio * ratio))),
      Math.min(A, Math.max(0.1, (8 * distance) / (seconds * seconds))),
    ]);
    const decelerations = sortedUnique([
      D,
      Math.min(D, Math.max(0.1, D / (ratio * ratio))),
      Math.min(D, Math.max(0.1, (8 * distance) / (seconds * seconds))),
    ]);
    for (const a of accelerations) {
      for (const acc of ratesNear(a, A, settings, 1)) {
        for (const d of decelerations) {
          for (const dec of ratesNear(d, D, settings, 1)) {
            const discriminant = seconds * seconds - 2 * distance * (1 / acc + 1 / dec);
            if (discriminant < -1e-10) continue;
            const peak = (2 * distance) / (seconds + Math.sqrt(Math.max(0, discriminant)));
            for (const cap of ratesNear(peak, V, settings, 1)) {
              yield { pos: target, vel: cap, accVel: acc, decVel: dec };
            }
          }
        }
      }
    }
    return;
  }
  const L = request.L!;
  const s = request.s!;
  const decelerations = [request.dec!];
  if (family === "endpoint") {
    decelerations.push(D / 2, D / 4, D / 10);
    if (request.command !== null) yield { ...request.command };
  }
  for (const idealDec of decelerations) {
    for (const dec of ratesNear(idealDec, D, settings, 0)) {
      if (family !== "endpoint" && Math.abs(dec - request.dec!) > 1e-8) continue;
      const target = request.target ?? targetOnWire(q + (s * w * w) / (2 * dec), device, index, settings);
      const B = seconds + w / dec;
      const C = (1 / A + 1 / dec) / 2;
      const K = L + (w * w) / (2 * dec);
      const discriminant = B * B - 4 * C * K;
      if (discriminant < -1e-8) continue;
      const peak = (2 * K) / (B + Math.sqrt(Math.max(0, discriminant)));
      const caps = sortedUnique([...ratesNear(Math.max(w, peak), V, settings, 2), ...ratesNear(w, V, settings, 1)]);
      const effective = s * (target - current) - (w * w) / (2 * dec);
      for (const cap of caps) {
        if (cap < w - 1e-9) continue;
        const denominator = 2 * (cap * seconds - ((cap - w) * (cap - w)) / (2 * dec) - effective);
        if (denominator <= 0) continue;
        for (const acc of ratesNear((cap * cap) / denominator, A, settings, 2)) {
          yield { pos: target, vel: cap, accVel: acc, decVel: dec };
        }
      }
      // 接入时仍在加速：瞬时速度允许小于协议最小指令速度0.1
      for (const cap of ratesNear(Math.max(w, 0.1), V, settings, 1)) {
        if (cap < w - 1e-9) continue;
        for (const acc of ratesNear(w / seconds, A, settings, 1)) {
          yield { pos: target, vel: cap, accVel: acc, decVel: dec };
        }
      }
    }
  }
}

type PlanMove = { role: "run_up" | "reposition"; at: "clock_start"; move: EntryMove; send_u: number };

type VerifyResult = {
  max_position_error: number;
  max_velocity_error: number;
  entry_monotonic: boolean;
  simultaneous_start: boolean;
  limits_passed: boolean;
  passed: boolean;
};

type Entry = {
  axis: AxisName;
  index: AxisIndex;
  kind: "in_place" | "run_up" | "reposition";
  lead_ms: number;
  join: [number, number];
  moves: PlanMove[];
  distance?: number;
  run_up_distance?: number;
  certificate?: [string, VerifyResult];
};

type Plan = { u0: number; lead_ms: number; entries: [Device, Entry][]; clock_start_u: number };

const entryForTime = (request: AxisRequest, seconds: number, u0: number, settings: Settings): Entry | null => {
  const { device, index, family } = request;
  const kind = family === "hold" ? "in_place" : request.v ? "run_up" : "reposition";
  const seen = new Set<string>();
  for (const move of candidateMoves(request, seconds, settings)) {
    checkDeadline();
    const key = `${move.pos}|${move.vel}|${move.accVel}|${move.decVel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (Math.min(move.vel, move.accVel, move.decVel) <= 0 || Math.max(move.vel, move.accVel, move.decVel) > RATE_LIMIT + 1e-8) {
      continue;
    }
    if (!(device.lower[index]! - EPS <= move.pos && move.pos <= device.upper[index]! + EPS)) continue;
    if (
      family !== "hold" &&
      (move.vel > request.V + 1e-8 || move.accVel > request.A + 1e-8 || move.decVel > request.D + 1e-8)
    ) {
      continue;
    }
    const phases = moveProfile(request.current, 0, move.pos, move.vel, move.accVel, move.decVel);
    const [q, v] = profileAt(phases, move.pos, seconds);
    if (
      Math.abs(q - request.q) > settings.entry_position_tolerance + 1e-9 ||
      Math.abs(v - request.v) > ENTRY_MATCH_VELOCITY_TOLERANCE + 1e-9
    ) {
      continue;
    }
    if (family === "rest" && seconds - profileDuration(phases) > ARRIVAL_TOLERANCE_MS / 1000 + 1e-9) continue;
    // 同一接入帧若已停在同一停车点，后续与准备V/A/D无关；只复用已由完整回放证实的失败
    const actualSeconds = (u0 - pythonRound(u0 - seconds * 1000, settings.entry_send_time_decimals)) / 1000;
    const [actualQ, actualV] = profileAt(phases, move.pos, actualSeconds);
    if (actualV === 0 && actualQ === move.pos && device.restTailFailures.has(`${index}|${u0}|${actualQ}`)) continue;
    const entry: Entry = {
      axis: AXIS_NAMES[index]!,
      index,
      kind,
      lead_ms: kind === "in_place" ? 0 : seconds * 1000,
      join: [request.q, request.v],
      moves: [{ role: request.v ? "run_up" : "reposition", at: "clock_start", move, send_u: 0 }],
    };
    if (kind !== "in_place") entry.distance = request.L;
    if (kind === "run_up") entry.run_up_distance = (request.w * request.w) / (2 * move.accVel);
    const plan = materialize({ u0, lead_ms: seconds * 1000, entries: [[device, entry]], clock_start_u: 0 }, settings);
    if (verify(plan, settings, true).passed) return entry;
  }
  return null;
};

const materialize = (plan: Plan, settings: Settings): Plan => {
  plan.clock_start_u = pythonRound(plan.u0 - plan.lead_ms, settings.entry_send_time_decimals);
  for (const [, entry] of plan.entries) {
    for (const move of entry.moves) move.send_u = plan.clock_start_u;
  }
  return plan;
};

const planAt = (devices: readonly Device[], u0: number, settings: Settings, requests?: AxisRequest[]): Plan => {
  const all = requests ?? devices.flatMap((device) => AXES.map((index) => axisRequest(device, index, u0, settings)));
  const lower = all.length ? Math.max(...all.map((request) => request.minimum)) : 0;
  const upper = all.length ? Math.min(...all.map((request) => request.maximum)) : Number.POSITIVE_INFINITY;
  if (lower > upper + 1e-9) throw new EntryInfeasible(["所有虚轴的单Move准备时间无公共可行区间"]);
  const times = new Set<number>([lower]);
  for (const request of all) {
    checkDeadline();
    if (request.family === "cruise") {
      const w = request.w;
      const L = request.L!;
      const denominator = 2 * (w * lower - L);
      if (denominator > 0) {
        for (const acc of ratesNear((w * w) / denominator, request.A, settings, 3)) times.add(L / w + w / (2 * acc));
      }
    }
    if (request.family === "endpoint" || request.family === "deceleration" || request.family === "transient_deceleration") {
      const L = request.L!;
      const w = request.w;
      const A = request.A;
      const D = request.dec!;
      const peak = Math.min(request.V, Math.sqrt((2 * A * D * L + A * w * w) / (A + D)));
      for (const cap of ratesNear(peak, request.V, settings, 2)) {
        if (cap >= w) times.add((L + (cap * cap) / (2 * A) + ((cap - w) * (cap - w)) / (2 * D)) / cap);
      }
    }
  }
  // 编码邻点时间，不以停等或额外指令填补
  for (let k = 1; k < 11; k += 1) times.add(lower + k / 10000);
  if (Number.isFinite(upper)) {
    times.add(upper);
    for (let k = 1; k < 16; k += 1) times.add(lower + ((upper - lower) * k) / 16);
  } else {
    for (const k of [2, 5, 10, 20, 50, 100]) times.add(lower + k / 1000);
  }
  // 固定T的各轴核验互相独立；先试最近失败的轴，成功后仍按原模型/轴顺序输出
  const priority = devices[0]!.entryFailureOrder ?? [];
  const slotKey = (request: AxisRequest) => `${request.device.serial}|${request.index}`;
  const slots = new Map(all.map((request, slot) => [slotKey(request), slot]));
  const preferred = priority.filter((key) => slots.has(key)).map((key) => slots.get(key)!);
  const order = [...preferred, ...all.map((_, slot) => slot).filter((slot) => !preferred.includes(slot))];
  const candidates = [...times].filter((t) => lower - 1e-9 <= t && t <= upper + 1e-9).sort((left, right) => left - right);
  for (const seconds of candidates) {
    checkDeadline();
    const entries: ([Device, Entry] | null)[] = all.map(() => null);
    let failed = false;
    for (const slot of [...order]) {
      const request = all[slot]!;
      const entry = entryForTime(request, seconds, u0, settings);
      if (entry === null) {
        const key = slotKey(request);
        const at = priority.indexOf(key);
        if (at >= 0) priority.splice(at, 1);
        priority.unshift(key);
        priority.splice(12);
        devices[0]!.entryFailureOrder = priority;
        order.splice(order.indexOf(slot), 1);
        order.unshift(slot);
        failed = true;
        break;
      }
      entries[slot] = [request.device, entry];
    }
    if (failed) continue;
    const plan = materialize(
      { u0, lead_ms: seconds * 1000, entries: entries as [Device, Entry][], clock_start_u: 0 },
      settings,
    );
    if (verify(plan, settings).passed) return plan;
  }
  throw new EntryInfeasible(["该帧无可编码的同时起步单Move自然接续方案"]);
};

// ---------------------------------------------------------------------------
// 七、连续选点，当前原动作段优先，比较单Move的共同准备时间
// ---------------------------------------------------------------------------

type Observer = (...owners: (Device | null)[]) => void;

const requestsAt = (
  devices: readonly Device[],
  u: number,
  settings: Settings,
  stopOnEmpty = false,
  observer?: Observer,
): [AxisRequest[], number, number] | null => {
  const requests: AxisRequest[] = [];
  let lower = 0;
  let upper = Number.POSITIVE_INFINITY;
  let lowerOwner: Device | null = null;
  let upperOwner: Device | null = null;
  let device: Device | null = null;
  try {
    for (device of devices) {
      checkDeadline();
      for (const index of AXES) {
        const request = axisRequest(device, index, u, settings);
        requests.push(request);
        if (observer !== undefined) {
          if (request.minimum > lower) lowerOwner = device;
          if (request.maximum < upper) upperOwner = device;
        }
        lower = Math.max(lower, request.minimum);
        upper = Math.min(upper, request.maximum);
        if (stopOnEmpty && lower > upper + 1e-9) {
          observer?.(lowerOwner, upperOwner, device);
          return null;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof EntryInfeasible)) throw error;
    observer?.(lowerOwner, upperOwner, device);
    return null;
  }
  observer?.(lowerOwner, upperOwner);
  return [requests, lower, upper];
};

/** 只对可证明单调的开放 phase 使用二分；边界/容差疑点保守走原网格 */
const phaseIsMonotone = (devices: readonly Device[], first: number, last: number, settings: Settings): boolean => {
  const middle = (first + last) / 2;
  const tolerance = settings.entry_velocity_tolerance;
  for (const device of devices) {
    checkDeadline();
    for (let index = 0; index < device.tracks.length; index += 1) {
      const track = device.tracks[index]!;
      const segment = track.segmentContaining(middle);
      if (first < segment.u0 || last >= segment.u1) return false;
      const [q1, v1] = segment.state(first);
      const [q2, v2] = segment.state(last);
      if (Math.min(q1, q2) < device.lower[index]! - EPS || Math.max(q1, q2) > device.upper[index]! + EPS) return false;
      if (segment.a === 0 && v1 === 0 && v2 === 0) continue;
      if (Math.min(Math.abs(v1), Math.abs(v2)) <= tolerance || v1 * v2 <= 0) return false;
      const [V, A, D] = device.prepareCaps[index]!;
      if (Math.max(Math.abs(v1), Math.abs(v2)) > V + 1e-8) return false;
      for (const u of [first, last]) {
        const at = bisectLeft(track.sendTimes, u);
        if (
          (at < track.sendTimes.length && Math.abs(track.sendTimes[at]! - u) <= 1e-8) ||
          (at && Math.abs(track.sendTimes[at - 1]! - u) <= 1e-8)
        ) {
          return false;
        }
      }
      const direction = v1 > 0 ? 1 : -1;
      const alpha = direction * segment.a;
      const vscale = Math.max(
        1,
        Math.abs(segment.v0),
        Math.abs((segment.a * (first - segment.u0)) / 1000),
        Math.abs((segment.a * (last - segment.u0)) / 1000),
      );
      const vguard = 64 * ulp(vscale);
      if (Math.min(Math.abs(v1), Math.abs(v2)) <= tolerance + vguard) return false;
      const qscale = Math.max(1, Math.abs(q1), Math.abs(q2), Math.abs(device.current[index]!));
      const qguard = Math.max(1e-14, 64 * ulp(qscale));
      if (A > 0) {
        const kinetic1 = (v1 * v1) / (2 * A);
        const kinetic2 = (v2 * v2) / (2 * A);
        const reachguard = Math.max(1e-14, 64 * ulp(Math.max(qscale, Math.abs(kinetic1), Math.abs(kinetic2))));
        const reach2 = direction * (q2 - device.current[index]!) - kinetic2;
        if (Math.abs(reach2 + 1e-9) <= reachguard) return false;
      }
      const rates = [A, D, Math.abs(alpha)].filter((rate) => rate > 0);
      const noise = qguard / Math.min(Math.abs(v1), Math.abs(v2)) + (rates.length ? vguard / Math.min(...rates) : 0);
      if (noise > settings.frame_resolution_ms / 1000 / 64) return false;
      if (alpha > 0) {
        const errors = [
          [q1, v1],
          [q2, v2],
        ].map(([q, v]) => Math.abs(direction * (q! - device.current[index]!) - (v! * v!) / (2 * alpha)));
        const edge = settings.entry_position_tolerance;
        const guard = Math.max(1e-7, 64 * ulp(Math.max(qscale, (v1 * v1) / (2 * alpha), (v2 * v2) / (2 * alpha))));
        if (Math.min(...errors) <= edge + guard && Math.max(...errors) >= edge - guard) return false;
      } else if (alpha < 0) {
        if (segment.command === null) return false;
        const dec = Math.abs(segment.a);
        const pos = segment.command.pos;
        const errors = [
          [q1, v1],
          [q2, v2],
        ].map(([q, v]) => Math.abs(direction * (pos - q!) - (v! * v!) / (2 * dec)));
        const guard = Math.max(1e-7, 64 * ulp(Math.max(qscale, (v1 * v1) / (2 * dec), (v2 * v2) / (2 * dec))));
        if (Math.min(...errors) <= 1e-5 + guard && Math.max(...errors) >= 1e-5 - guard) return false;
      }
    }
  }
  return true;
};

type Grid = { values: number[] };
type Cursor = [grid: Grid, index: number, end: number];
type HeapNode =
  | { bound: number; u: number; serial: number; kind: "point_hint"; frame: number; cursor: Cursor | null }
  | { bound: number; u: number; serial: number; kind: "interval_hint"; grid: Grid; lo: number; hi: number }
  | { bound: number; u: number; serial: number; kind: "point"; requests: AxisRequest[]; cursor: Cursor | null };

type HeapNodeInput = HeapNode extends infer Node ? (Node extends HeapNode ? Omit<Node, "serial"> : never) : never;

/** (bound, u, serial) 最小堆，和 Python heapq 的元组比较同序 */
class NodeHeap {
  private readonly items: HeapNode[] = [];

  get size(): number {
    return this.items.length;
  }

  private static less(left: HeapNode, right: HeapNode): boolean {
    if (left.bound !== right.bound) return left.bound < right.bound;
    if (left.u !== right.u) return left.u < right.u;
    return left.serial < right.serial;
  }

  push(node: HeapNode): void {
    const items = this.items;
    items.push(node);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!NodeHeap.less(items[index]!, items[parent]!)) break;
      [items[index], items[parent]] = [items[parent]!, items[index]!];
      index = parent;
    }
  }

  pop(): HeapNode {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = 2 * index + 1;
        const right = left + 1;
        let smallest = index;
        if (left < items.length && NodeHeap.less(items[left]!, items[smallest]!)) smallest = left;
        if (right < items.length && NodeHeap.less(items[right]!, items[smallest]!)) smallest = right;
        if (smallest === index) break;
        [items[index], items[smallest]] = [items[smallest]!, items[index]!];
        index = smallest;
      }
    }
    return top;
  }
}

const searchWindow = (
  devices: readonly Device[],
  lower: number,
  upper: number,
  toCurve: (run: number) => number,
  toRun: (curve: number) => number,
  settings: Settings,
): [Plan | null, number] => {
  if (!devices.some((device) => device.moves)) {
    try {
      return [planAt(devices, lower, settings), 1];
    } catch (error) {
      if (error instanceof EntryInfeasible) return [null, 1];
      throw error;
    }
  }
  const resolution = settings.frame_resolution_ms;
  const forward = toRun(1) > toRun(0);
  const pointSet = new Set<number>([lower, upper]);
  for (const device of devices) {
    checkDeadline();
    for (const track of device.tracks) for (const value of track.boundaries(lower, upper)) pointSet.add(value);
  }
  const points = [...pointSet].sort((left, right) => left - right);
  const boundaryFrames = new Set(points.map((u) => toCurve(u)));
  // 子集只给保守下界，绝不用子集决定可执行；真正候选仍验证所有模型
  const baseIndices =
    devices.length <= 8
      ? devices.map((_, index) => index)
      : Array.from({ length: 8 }, (_, k) => pythonRoundInt((k * (devices.length - 1)) / 7));
  const priority = devices[0]!.probeIndices ?? [];
  const deviceIndices = new Map(devices.map((device, index) => [device, index]));
  let sample: Device[] = [];
  let sampleKey: string | null = null;
  const getSample = (): Device[] => {
    const indices = [...new Set([...priority, ...baseIndices])];
    const key = indices.join(",");
    if (key !== sampleKey) {
      sample = indices.map((index) => devices[index]!);
      sampleKey = key;
    }
    return sample;
  };
  const observe: Observer = (...owners) => {
    for (const owner of owners) {
      if (owner !== null) {
        const index = deviceIndices.get(owner)!;
        if (!priority.includes(index)) priority.push(index);
      }
    }
    if (priority.length > 12) priority.splice(0, priority.length - 12);
    devices[0]!.probeIndices = priority;
  };
  const heap = new NodeHeap();
  let serial = 0;
  let evaluated = 0;
  const push = (node: HeapNodeInput) => {
    heap.push({ ...node, serial } as HeapNode);
    serial += 1;
  };
  const hintPoint = (frame: number, cursor: Cursor | null = null): boolean => {
    const u = toRun(frame);
    const computed = requestsAt(getSample(), u, settings, true);
    if (computed !== null) {
      push({ bound: computed[1] * 1000, u, kind: "point_hint", frame, cursor });
      return true;
    }
    return false;
  };
  const exactPoint = (frame: number, cursor: Cursor | null = null): boolean => {
    const u = toRun(frame);
    const computed = requestsAt(devices, u, settings, true, observe);
    if (computed !== null) {
      const [requests, lo] = computed;
      push({ bound: lo * 1000, u, kind: "point", requests, cursor });
      return true;
    }
    return false;
  };
  const advance = (cursor: Cursor): void => {
    const [grid, start, end] = cursor;
    for (let index = start; index <= end; index += 1) {
      checkDeadline();
      if (exactPoint(grid.values[index]!, [grid, index + 1, end])) return;
    }
  };
  const materializeInterval = (grid: Grid, lo: number, hi: number): void => {
    const first = toRun(grid.values[lo]!);
    const last = toRun(grid.values[hi]!);
    if (!phaseIsMonotone(devices, first, last, settings)) {
      for (let index = lo; index <= hi; index += 1) {
        if (!boundaryFrames.has(grid.values[index]!)) hintPoint(grid.values[index]!);
      }
      return;
    }
    const computed = requestsAt(devices, last, settings, false, observe);
    if (computed === null) return;
    const [requests] = computed;
    const moving = requests.filter((r) => r.family !== "hold" && r.family !== "rest");
    const resting = requests.filter((r) => r.family === "hold" || r.family === "rest");
    const movingMin = moving.length ? Math.max(...moving.map((r) => r.minimum)) : 0;
    const accelerating = moving.filter((r) => r.family === "acceleration");
    const fixedMax = accelerating.length ? Math.min(...accelerating.map((r) => r.maximum)) : Number.POSITIVE_INFINITY;
    const jointGuard = Math.max(
      1e-12,
      64 * ulp(Math.max(1, Math.abs(movingMin), Number.isFinite(fixedMax) ? Math.abs(fixedMax) : 1)),
    );
    if (Number.isFinite(fixedMax) && Math.abs(movingMin - fixedMax - 1e-9) <= jointGuard) {
      for (let index = lo; index <= hi; index += 1) hintPoint(grid.values[index]!);
      return;
    }
    const restMin = resting.length ? Math.max(...resting.map((r) => r.minimum)) : 0;
    const restMax = resting.length ? Math.min(...resting.map((r) => r.maximum)) : Number.POSITIVE_INFINITY;
    if (restMin > restMax + 1e-9) return;
    let high = hi;
    if (moving.length && Number.isFinite(restMax)) {
      const C = Math.max(...moving.map((r) => r.minimum - last / 1000));
      const cut = Math.floor(((restMax - C) * 1000 - first) / resolution) + lo;
      for (let index = Math.max(lo, cut - 2); index <= Math.min(high, cut + 2); index += 1) {
        hintPoint(grid.values[index]!);
      }
      high = Math.min(high, cut - 3);
      if (high < lo) return;
    }
    if (requestsAt(devices, toRun(grid.values[high]!), settings, true, observe) === null) return;
    const begin = lo;
    const end = high;
    let left = lo;
    let right = high;
    while (left < right) {
      const middle = (left + right) >> 1;
      if (requestsAt(devices, toRun(grid.values[middle]!), settings, true, observe) === null) left = middle + 1;
      else right = middle;
    }
    advance([grid, Math.max(begin, left - 1), end]);
  };
  const intervalBound = (grid: Grid, lo: number, hi: number): number | null => {
    const first = toRun(grid.values[lo]!);
    const last = toRun(grid.values[hi]!);
    const subset = getSample();
    if (!phaseIsMonotone(subset, first, last, settings)) return 0;
    const computed = requestsAt(subset, last, settings);
    if (computed === null) return null;
    const [requests, lowerAtEnd] = computed;
    const movingRequests = requests.filter((r) => r.family !== "hold" && r.family !== "rest");
    const movingUpper = movingRequests.length
      ? Math.min(...movingRequests.map((r) => r.maximum))
      : Number.POSITIVE_INFINITY;
    const guardSec = Math.max(
      1e-12,
      64 * ulp(Math.max(1, Math.abs(lowerAtEnd), Number.isFinite(movingUpper) ? Math.abs(movingUpper) : 1)),
    );
    // 安全 phase 中，运动轴的共同可行性只能由 False 变 True；右端仍冲突则整段无解
    if (lowerAtEnd > movingUpper + 1e-9 + guardSec) return null;
    let bound =
      (requests.length
        ? Math.max(
            ...requests.map((r) =>
              r.family === "hold" || r.family === "rest" ? r.minimum : r.minimum - (last - first) / 1000,
            ),
          )
        : 0) * 1000;
    const roundingGuard = Math.max(
      1e-4,
      ...requests.map((r) => 64 * ulp(Math.max(1, Math.abs(r.minimum) * 1000, Math.abs(last - first)))),
    );
    bound = Math.max(0, bound - roundingGuard);
    const restingRequests = requests.filter((r) => r.family === "hold" || r.family === "rest");
    const restMax = restingRequests.length
      ? Math.min(...restingRequests.map((r) => r.maximum))
      : Number.POSITIVE_INFINITY;
    if (bound / 1000 > restMax + 1e-9 + guardSec) return null;
    return bound;
  };
  for (const frame of [...boundaryFrames].sort((left, right) => toRun(left) - toRun(right))) {
    checkDeadline();
    hintPoint(frame);
  }
  for (let index = 0; index + 1 < points.length; index += 1) {
    checkDeadline();
    const left = points[index]!;
    const right = points[index + 1]!;
    const [lowCurve, highCurve] = [toCurve(left), toCurve(right)].sort((a, b) => a - b) as [number, number];
    const lowGrid = Math.ceil(lowCurve / resolution) * resolution;
    const highGrid = Math.floor(highCurve / resolution) * resolution;
    const values: number[] = [];
    if (forward) for (let frame = lowGrid; frame <= highGrid; frame += resolution) values.push(frame);
    else for (let frame = highGrid; frame >= lowGrid; frame -= resolution) values.push(frame);
    if (values.length === 0) continue;
    const grid: Grid = { values };
    let lo = 0;
    let hi = values.length - 1;
    const outside = (frame: number) => {
      const u = toRun(frame);
      return boundaryFrames.has(frame) || !(left < u && u < right);
    };
    while (lo <= hi && outside(values[lo]!)) lo += 1;
    while (lo <= hi && outside(values[hi]!)) hi -= 1;
    if (lo > hi) continue;
    if (hi - lo < 3) {
      for (let at = lo; at <= hi; at += 1) hintPoint(values[at]!);
      continue;
    }
    const bound = intervalBound(grid, lo, hi);
    if (bound !== null) push({ bound, u: toRun(values[lo]!), kind: "interval_hint", grid, lo, hi });
  }
  const plans: Plan[] = [];
  let shortest = Number.POSITIVE_INFINITY;
  const tie = settings.entry_lead_tie_ms;
  while (heap.size > 0) {
    checkDeadline();
    const node = heap.pop();
    const { bound, u } = node;
    if (bound > shortest + tie + 1e-8) break;
    // 已有方案同时更快且帧更早时，该节点及安全后继都不会成为最终结果
    if (
      plans.some(
        (plan) =>
          plan.u0 <= u &&
          plan.lead_ms + Math.max(1e-5, 64 * ulp(Math.max(1, Math.abs(bound), Math.abs(plan.lead_ms)))) <= bound,
      )
    ) {
      continue;
    }
    if (node.kind === "point_hint") {
      if (!exactPoint(node.frame, node.cursor) && node.cursor !== null) advance(node.cursor);
      continue;
    }
    if (node.kind === "interval_hint") {
      const strengthened = intervalBound(node.grid, node.lo, node.hi);
      if (strengthened === null) continue;
      if (strengthened > bound + 1e-8) {
        push({ bound: strengthened, u, kind: "interval_hint", grid: node.grid, lo: node.lo, hi: node.hi });
        continue;
      }
      materializeInterval(node.grid, node.lo, node.hi);
      continue;
    }
    evaluated += 1;
    try {
      const plan = planAt(devices, u, settings, node.requests);
      plans.push(plan);
      shortest = Math.min(shortest, plan.lead_ms);
    } catch (error) {
      if (!(error instanceof EntryInfeasible)) throw error;
    }
    if (node.cursor !== null) advance(node.cursor);
  }
  let best: Plan | null = null;
  for (const plan of plans) {
    if (plan.lead_ms <= shortest + tie + 1e-8 && (best === null || plan.u0 < best.u0)) best = plan;
  }
  return [best, evaluated];
};

type Window = [low: number, high: number, phase: NonforcedSearchAttempt["phase"]];

const windowsOf = (
  devices: readonly Device[],
  first: number,
  last: number,
  reverse: boolean,
  reference: number | null,
): Window[] => {
  const boundarySet = new Set<number>([first, last]);
  for (const device of devices) {
    if (device.moves) for (const frame of device.keyframes) if (first <= frame && frame <= last) boundarySet.add(frame);
  }
  const boundaries = [...boundarySet].sort((left, right) => left - right);
  const pairs: [number, number][] = [];
  for (let index = 0; index + 1 < boundaries.length; index += 1) pairs.push([boundaries[index]!, boundaries[index + 1]!]);
  const windows: [number, number][] = pairs.length ? pairs : [[first, last]];
  if (reference === null) return [[first, last, "whole_action"]];
  let ordered: [number, number][];
  if (!reverse) {
    const found = windows.findIndex(([low, high]) => low <= reference && reference < high);
    ordered = windows.slice(found >= 0 ? found : windows.length - 1);
  } else {
    const found = windows.findIndex(([low, high]) => low < reference && reference <= high);
    ordered = windows.slice(0, (found >= 0 ? found : 0) + 1).reverse();
  }
  // 有参考帧（继续/反向回）时只查当前段和运行方向后续段，不回头兜底到动作起点
  return ordered.map(([low, high], index) => [low, high, index === 0 ? "current_segment" : "directional_fallback"]);
};

// ---------------------------------------------------------------------------
// 八、最终编码回放：位置、速度、后续整段、行程、能力和同时起步均纳入通过条件
// ---------------------------------------------------------------------------

type Witness = [u: number, positionError: number, velocityError: number];

const candidateWitnessCache = (
  device: Device,
  index: AxisIndex,
  entry: Entry,
  u0: number,
  settings: Settings,
): [Map<string, Witness> | null, string | null] => {
  if (entry.moves.length !== 1) return [null, null];
  device.trajectoryErrorWitnesses ??= [new Map(), new Map(), new Map()];
  const groups = device.trajectoryErrorWitnesses;
  const track = device.tracks[index]!;
  const item = entry.moves[0]!;
  const move = item.move;
  const nextSend = bisectLeft(track.sendTimes, u0 - 1e-9);
  const key = [
    track.serial,
    device.current[index],
    item.send_u,
    move.pos,
    move.vel,
    move.accVel,
    move.decVel,
    nextSend,
    settings.entry_position_tolerance,
    ENTRY_MATCH_VELOCITY_TOLERANCE,
  ].join("|");
  return [groups[index], key];
};

const captureErrorWitness = (
  sink: Witness[] | null,
  u: number,
  actualSegment: Segment,
  referenceSegment: Segment,
  aq: number,
  av: number,
  rq: number,
  rv: number,
  limits: readonly [number, number],
): void => {
  if (sink === null || sink.length > 0) return;
  let qscale = Math.max(1, Math.abs(aq), Math.abs(rq));
  let vscale = Math.max(1, Math.abs(av), Math.abs(rv));
  for (const segment of [actualSegment, referenceSegment]) {
    qscale = Math.max(qscale, Math.abs(segment.q0));
    vscale = Math.max(vscale, Math.abs(segment.v0));
    if (segment.v0 || segment.a) {
      const dt = (u - segment.u0) / 1000;
      qscale = Math.max(qscale, Math.abs(segment.v0 * dt), Math.abs(0.5 * segment.a * dt * dt));
      vscale = Math.max(vscale, Math.abs(segment.a * dt));
    }
  }
  // 临界浮点点不用于跨帧证书，仍走完整判定；留宽松舍入余量
  const qguard = Math.max(1e-10, 256 * ulp(qscale));
  const vguard = Math.max(1e-10, 256 * ulp(vscale));
  const qe = Math.abs(aq - rq);
  const ve = Math.abs(av - rv);
  if (qe > limits[0] + qguard || ve > limits[1] + vguard) sink.push([u, qe, ve]);
};

/** 完整顺序合并 AxisTrack 相位，边界取右段，包含位置误差内部极值 */
const trajectoryErrorsSweep = (
  actual: AxisTrack,
  track: AxisTrack,
  u0: number,
  stopLimits: readonly [number, number] | null,
  witnessSink: Witness[] | null,
  witnessLimits: readonly [number, number] | null,
): [number, number] => {
  const actualSegments = actual.segments;
  const referenceSegments = track.segments;
  let ai = Math.max(0, bisectRight(actual.starts, u0) - 1);
  let ri = Math.max(0, bisectRight(track.starts, u0) - 1);
  let last = u0;
  for (const segments of [actualSegments, referenceSegments]) {
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index]!;
      const values = [segment.u0, segment.u1].filter((value) => Number.isFinite(value));
      if (values.length) {
        last = Math.max(last, Math.max(...values));
        break;
      }
    }
  }
  const horizon = last + 1000;
  const limits = stopLimits ?? witnessLimits;
  let worstPosition = 0;
  let worstVelocity = 0;
  let left = u0;
  for (;;) {
    checkDeadline();
    // 与 AxisTrack.state 的 bisect_right 相同：相位切换时刻用右段
    while (ai + 1 < actualSegments.length && actualSegments[ai + 1]!.u0 <= left) ai += 1;
    while (ri + 1 < referenceSegments.length && referenceSegments[ri + 1]!.u0 <= left) ri += 1;
    const actualSegment = actualSegments[ai]!;
    const referenceSegment = referenceSegments[ri]!;
    let [aq, av] = actualSegment.state(left);
    let [rq, rv] = referenceSegment.state(left);
    worstPosition = Math.max(worstPosition, Math.abs(aq - rq));
    worstVelocity = Math.max(worstVelocity, Math.abs(av - rv));
    if (limits !== null && (Math.abs(aq - rq) > limits[0] || Math.abs(av - rv) > limits[1])) {
      captureErrorWitness(witnessSink, left, actualSegment, referenceSegment, aq, av, rq, rv, limits);
    }
    if (stopLimits !== null && (worstPosition > stopLimits[0] || worstVelocity > stopLimits[1])) {
      return [worstPosition, worstVelocity];
    }
    if (left >= horizon) return [worstPosition, worstVelocity];
    const right = Math.min(actualSegment.u1, referenceSegment.u1, horizon);
    const acceleration = actualSegment.a - referenceSegment.a;
    if (Math.abs(acceleration) > 1e-12) {
      const extremum = left - ((av - rv) / acceleration) * 1000;
      if (left < extremum && extremum < right) {
        [aq, av] = actualSegment.state(extremum);
        [rq, rv] = referenceSegment.state(extremum);
        worstPosition = Math.max(worstPosition, Math.abs(aq - rq));
        worstVelocity = Math.max(worstVelocity, Math.abs(av - rv));
        if (limits !== null && (Math.abs(aq - rq) > limits[0] || Math.abs(av - rv) > limits[1])) {
          captureErrorWitness(witnessSink, extremum, actualSegment, referenceSegment, aq, av, rq, rv, limits);
        }
        if (stopLimits !== null && (worstPosition > stopLimits[0] || worstVelocity > stopLimits[1])) {
          return [worstPosition, worstVelocity];
        }
      }
    }
    left = right;
  }
};

const verify = (plan: Plan, settings: Settings, failFast = false): VerifyResult => {
  // 同一候选的单轴已完整验证；聚合/输出只复用相同最终时刻与指令的证书
  const entries = plan.entries;
  if (entries.length !== 1) {
    const results = entries.map(([device, entry]) =>
      verify({ u0: plan.u0, lead_ms: plan.lead_ms, clock_start_u: plan.clock_start_u, entries: [[device, entry]] }, settings, failFast),
    );
    return {
      max_position_error: results.length ? Math.max(...results.map((r) => r.max_position_error)) : 0,
      max_velocity_error: results.length ? Math.max(...results.map((r) => r.max_velocity_error)) : 0,
      entry_monotonic: results.every((r) => r.entry_monotonic),
      simultaneous_start: results.every((r) => r.simultaneous_start),
      limits_passed: results.every((r) => r.limits_passed),
      passed: results.every((r) => r.passed),
    };
  }
  const [device, entry] = entries[0]!;
  const index = entry.index;
  const key = [
    plan.u0,
    plan.clock_start_u,
    entry.kind,
    entry.join[0],
    entry.join[1],
    ...entry.moves.flatMap((m) => [m.send_u, m.move.pos, m.move.vel, m.move.accVel, m.move.decVel]),
    settings.entry_position_tolerance,
    ENTRY_MATCH_VELOCITY_TOLERANCE,
    device.tracks[index]!.serial,
    device.current[index],
    device.lower[index],
    device.upper[index],
    ...device.prepareCaps[index]!,
  ].join("|");
  const cached = entry.certificate;
  if (cached !== undefined && cached[0] === key) return cached[1];
  // 失败见证可提前返回，但不能把不完整失败指标放进完整验证证书
  const result = verifyUncached(plan, settings, failFast);
  if (!failFast || result.passed) entry.certificate = [key, result];
  return result;
};

const verifyUncached = (plan: Plan, settings: Settings, failFast: boolean): VerifyResult => {
  const u0 = plan.u0;
  let worstPosition = 0;
  let worstVelocity = 0;
  let monotonic = true;
  let limitsOk = true;
  let simultaneous = true;
  let actual: AxisTrack | null = null;
  let lastEntry: Entry | null = null;
  let lastDevice: Device | null = null;
  for (const [device, entry] of plan.entries) {
    checkDeadline();
    lastEntry = entry;
    lastDevice = device;
    const index = entry.index;
    const track = device.tracks[index]!;
    const [witnessCache, witnessKey] = candidateWitnessCache(device, index, entry, u0, settings);
    const cachedWitness = witnessCache !== null ? witnessCache.get(witnessKey!) : undefined;
    if (failFast && cachedWitness !== undefined && u0 <= cachedWitness[0]) {
      // 相同准备指令/时刻/初态/原表后继即相同 actual 轨迹，区间仍包含已超限点
      return {
        max_position_error: cachedWitness[1],
        max_velocity_error: cachedWitness[2],
        entry_monotonic: true,
        simultaneous_start: true,
        limits_passed: true,
        passed: false,
      };
    }
    const sends: [number, EntryMove][] = entry.moves.map((move): [number, EntryMove] => [move.send_u, move.move]);
    for (const [u, command] of track.sends) if (u >= u0 - 1e-9) sends.push([u, command]);
    // Python list.sort 稳定；Array.prototype.sort 也稳定
    sends.sort((left, right) => left[0] - right[0]);
    actual = new AxisTrack(device.current[index]!, sends);
    const preparation = entry.moves;
    simultaneous &&= preparation.length === 1 && Math.abs(preparation[0]!.send_u - plan.clock_start_u) <= 1e-8;
    if (entry.kind !== "in_place") {
      simultaneous &&= preparation.length > 0 && Math.abs(preparation[0]!.send_u - plan.clock_start_u) <= 1e-8;
    }
    const stopLimits: [number, number] | null = failFast
      ? [settings.entry_position_tolerance + 1e-9, ENTRY_MATCH_VELOCITY_TOLERANCE + 1e-9]
      : null;
    const witness: Witness[] = [];
    const witnessLimits: [number, number] = [
      settings.entry_position_tolerance + 1e-9,
      ENTRY_MATCH_VELOCITY_TOLERANCE + 1e-9,
    ];
    const [axisPosition, axisVelocity] = trajectoryErrorsSweep(actual, track, u0, stopLimits, witness, witnessLimits);
    if (witness.length && witnessCache !== null) {
      const previous = witnessCache.get(witnessKey!);
      if (previous === undefined || witness[0]![0] > previous[0]) {
        if (previous === undefined && witnessCache.size >= 4096) {
          witnessCache.delete(witnessCache.keys().next().value as string);
        }
        witnessCache.set(witnessKey!, witness[0]!);
      }
    }
    worstPosition = Math.max(worstPosition, axisPosition);
    worstVelocity = Math.max(worstVelocity, axisVelocity);
    if (failFast && (worstPosition > stopLimits![0] || worstVelocity > stopLimits![1])) {
      // 误差最大值只增不减：已有超限见证足以拒绝；完全停在同一停车点的接后失败可安全复用
      const [aq, av] = actual.state(u0);
      if (av === 0 && aq === entry.moves[0]!.move.pos) device.restTailFailures.add(`${index}|${u0}|${aq}`);
      return {
        max_position_error: worstPosition,
        max_velocity_error: worstVelocity,
        entry_monotonic: monotonic,
        simultaneous_start: simultaneous,
        limits_passed: limitsOk,
        passed: false,
      };
    }
    const direction = entry.join[1] ? (entry.join[1] > 0 ? 1 : -1) : entry.join[0] >= device.current[index]! ? 1 : -1;
    for (const segment of actual.segments) {
      checkDeadline();
      const left = Math.max(segment.u0, plan.clock_start_u);
      let right = segment.u1;
      if (right <= left || !Number.isFinite(left)) continue;
      if (!Number.isFinite(right)) right = left;
      const [leftQ, leftV] = segment.state(left);
      const [rightQ, rightV] = segment.state(right);
      const positions = [leftQ, rightQ];
      const velocities = [leftV, rightV];
      if (segment.a) {
        const zero = segment.u0 - (segment.v0 / segment.a) * 1000;
        if (left < zero && zero < right) positions.push(segment.state(zero)[0]);
      }
      limitsOk &&=
        Math.min(...positions) >= device.lower[index]! - 1e-8 &&
        Math.max(...positions) <= device.upper[index]! + 1e-8 &&
        Math.max(...velocities.map((value) => Math.abs(value))) <= device.repositionVelocity[index]! + 1e-8;
      const limit =
        segment.a * pythonSum(velocities) >= 0
          ? device.repositionAcceleration[index]!
          : device.repositionDeceleration[index]!;
      limitsOk &&= Math.abs(segment.a) <= limit + 1e-8;
      if (left < u0 - 1e-8 && entry.kind !== "in_place") {
        const end = Math.min(right, u0);
        monotonic &&= Math.min(segment.state(left)[1] * direction, segment.state(end)[1] * direction) >= -1e-7;
        // 不规划停等或延迟起步；静止目标只允许1ms以内的编码停稳时差
        const roundingMs = Math.max(ARRIVAL_TOLERANCE_MS, 10 ** -settings.entry_send_time_decimals);
        simultaneous &&= !(
          end > left + roundingMs + 1e-7 &&
          Math.abs(segment.a) < 1e-10 &&
          Math.abs(segment.state(left)[1]) < 1e-10
        );
      }
    }
    for (const [, command] of sends) {
      checkDeadline();
      limitsOk &&= device.lower[index]! - 1e-8 <= command.pos && command.pos <= device.upper[index]! + 1e-8;
      limitsOk &&= -214748364.8 <= command.pos && command.pos <= 214748364.7;
      limitsOk &&= Math.max(command.vel, command.accVel, command.decVel) <= RATE_LIMIT + 1e-8;
      const checks = [
        [command.vel, device.repositionVelocity[index]!],
        [command.accVel, device.repositionAcceleration[index]!],
        [command.decVel, device.repositionDeceleration[index]!],
      ] as const;
      for (const [value, maximum] of checks) {
        // 不存在的虚轴 max=0 仅允许当前位置保持；真实运动仍在上面按 0 能力验证
        limitsOk &&= value <= maximum + 1e-8 || (entry.kind === "in_place" && maximum === 0);
      }
    }
  }
  if (
    (worstPosition > settings.entry_position_tolerance + 1e-9 ||
      worstVelocity > ENTRY_MATCH_VELOCITY_TOLERANCE + 1e-9) &&
    actual !== null &&
    lastEntry !== null &&
    lastDevice !== null
  ) {
    const [aq, av] = actual.state(u0);
    if (av === 0 && aq === lastEntry.moves[0]!.move.pos) lastDevice.restTailFailures.add(`${lastEntry.index}|${u0}|${aq}`);
  }
  return {
    max_position_error: worstPosition,
    max_velocity_error: worstVelocity,
    entry_monotonic: monotonic,
    simultaneous_start: simultaneous,
    limits_passed: limitsOk,
    passed:
      worstPosition <= settings.entry_position_tolerance + 1e-9 &&
      worstVelocity <= ENTRY_MATCH_VELOCITY_TOLERANCE + 1e-9 &&
      monotonic &&
      simultaneous &&
      limitsOk,
  };
};

// ---------------------------------------------------------------------------
// 九、对外入口
// ---------------------------------------------------------------------------

const infeasible = (
  reverse: boolean,
  mode: NonforcedFrameSelectionMode,
  reference: number | null,
  message: string,
  attempts: NonforcedSearchAttempt[],
  reasons: string[],
): NonforcedInfeasibleResult => ({
  status: "infeasible",
  message,
  algorithm_version: NONFORCED_ALGORITHM_VERSION,
  trajectory_run: false,
  reverse,
  frame_selection_mode: mode,
  reference_frame_ms: reference,
  selected_curve_time_ms: null,
  segment_search_attempts: attempts,
  reasons,
});

const timeoutResult = (parameters: unknown): NonforcedInfeasibleResult => {
  const raw = isRecord(parameters) ? parameters.command : undefined;
  const command = isRecord(raw) ? raw : {};
  const reference = (command.stopped_time_ms ?? null) as number | null;
  let mode: NonforcedFrameSelectionMode;
  if (command.use_specified_time === true) mode = "specified_frame";
  else if (("nearest_start" in command ? command.nearest_start : true) === false) mode = "action_boundary";
  else mode = reference !== null ? "current_segment_first" : "nearest_whole_action";
  return infeasible(command.reverse === true, mode, reference, "计算超时（超过5秒），本次未生成可执行接入方案", [], [
    "本次搜索未完成，不代表轨迹无解；不得下发未完成的准备参数",
  ]);
};

/** 输入公共参数（command/settings/models/runtime），返回接入方案；不修改输入 */
export const calculateNonforcedEntry = (parameters: unknown): NonforcedEntryResult => {
  const previous = deadline;
  deadline = now() + CALCULATION_TIMEOUT_MS;
  try {
    const result = calculate(parameters);
    checkDeadline();
    return result;
  } catch (error) {
    if (error instanceof EntryCalculationTimeout) return timeoutResult(parameters);
    return {
      status: "invalid_input",
      message: error instanceof Error ? error.message : String(error),
      algorithm_version: NONFORCED_ALGORITHM_VERSION,
    };
  } finally {
    deadline = previous;
  }
};

const calculate = (parameters: unknown): NonforcedEntryResult => {
  if (!isRecord(parameters)) throw new InvalidInput("输入须为对象");
  const settings = settingsOf(parameters);
  const command = commandOf(parameters);
  const models = parameters.models;
  if (!Array.isArray(models) || models.length === 0) throw new InvalidInput("models不能为空");
  const states = runtimeStates(parameters);
  const reverse = command.reverse;
  const direction: 1 | -1 = reverse ? -1 : 1;
  const parsedPieces = models.map((model) => piecesOf(isRecord(model) ? model : {}));
  const first = Math.min(...parsedPieces.map((pieces) => pieces[0]![0]));
  const last = Math.max(...parsedPieces.map((pieces) => pieces[pieces.length - 1]![1]));
  const runOrigin = reverse ? last : first;
  const toRun = (curve: number) => direction * (curve - runOrigin);
  const toCurve = (run: number) => runOrigin + direction * run;
  const devices = models.map(
    (model, index) => new Device(model, states, direction, runOrigin, command.loop, settings, parsedPieces[index]!),
  );

  let reference = command.stopped_time_ms;
  let clamped = false;
  if (reference !== null && !(first <= reference && reference <= last)) {
    reference = Math.min(Math.max(reference, first), last);
    clamped = true;
  }

  const attempts: NonforcedSearchAttempt[] = [];
  let evaluated = 0;
  let plan: Plan | null = null;
  let selectedWindow: [number, number] | null = null;
  let referenceWindow: [number, number] | null = null;
  let mode: NonforcedFrameSelectionMode;
  if (command.use_specified_time) {
    mode = "specified_frame";
    const specified = command.specified_time_ms!;
    if (!(first <= specified && specified <= last)) throw new InvalidInput("指定帧超出动作首末范围");
    try {
      plan = planAt(devices, toRun(specified), settings);
    } catch (error) {
      if (!(error instanceof EntryInfeasible)) throw error;
      return infeasible(reverse, mode, reference, `指定帧无法接入：${error.message}`, attempts, error.reasons);
    }
  } else if (!command.nearest_start) {
    mode = "action_boundary";
    try {
      plan = planAt(devices, 0, settings);
    } catch (error) {
      if (!(error instanceof EntryInfeasible)) throw error;
      return infeasible(reverse, mode, reference, `起点无法接入：${error.message}`, attempts, error.reasons);
    }
  } else {
    mode = reference !== null ? "current_segment_first" : "nearest_whole_action";
    const maxSkip = reference !== null ? settings.entry_max_skip_ms : null;
    let limitU: number | null = null;
    let limited = false;
    if (maxSkip !== null && reference !== null) {
      // 截止帧往参考帧一侧取到帧网格上：截后的候选正好是原候选里不超限的那部分
      const resolution = settings.frame_resolution_ms;
      const limitCurve = reference + direction * maxSkip;
      const snapped =
        (direction > 0 ? Math.floor(limitCurve / resolution + 1e-9) : Math.ceil(limitCurve / resolution - 1e-9)) *
        resolution;
      limitU = toRun(snapped);
    }
    for (const [low, high, phase] of windowsOf(devices, first, last, reverse, reference)) {
      checkDeadline();
      referenceWindow ??= [low, high];
      let [lower, upper] = [toRun(low), toRun(high)].sort((a, b) => a - b) as [number, number];
      const attempt: NonforcedSearchAttempt = { range_ms: [low, high], phase, status: "infeasible" };
      if (limitU !== null && upper > limitU + 1e-9) {
        limited = true;
        if (lower > limitU + 1e-9) {
          attempts.push({ ...attempt, status: "beyond_max_skip" });
          continue;
        }
        upper = limitU;
        attempt.searched_range_ms = [toCurve(lower), toCurve(upper)].sort((a, b) => a - b) as [number, number];
      }
      const [best, count] = searchWindow(devices, lower, upper, toCurve, toRun, settings);
      evaluated += count;
      attempts.push({ ...attempt, status: best ? "planned" : "infeasible" });
      if (best !== null) {
        plan = best;
        selectedWindow = [low, high];
        break;
      }
    }
    if (plan === null) {
      const reasons = devices.flatMap((device) =>
        AXES.flatMap((index) =>
          device.tableLimitReasons[index] ? [`${device.axisLabels[index]}${device.tableLimitReasons[index]}`] : [],
        ),
      );
      let message = "运行方向上没有可接入的帧";
      if (limited) message += `（接入帧最多比参考帧靠后${msText(maxSkip!)}ms）`;
      return infeasible(reverse, mode, reference, message, attempts, reasons);
    }
  }
  return planned(devices, plan, reverse, settings, mode, reference, clamped, referenceWindow, selectedWindow, attempts, evaluated, toCurve);
};

const route = (device: Device) => ({ plc_id: device.plcId, model_id: device.modelId, device_id: device.deviceId });

const planned = (
  devices: readonly Device[],
  plan: Plan,
  reverse: boolean,
  settings: Settings,
  mode: NonforcedFrameSelectionMode,
  reference: number | null,
  clamped: boolean,
  referenceWindow: [number, number] | null,
  selectedWindow: [number, number] | null,
  attempts: NonforcedSearchAttempt[],
  evaluated: number,
  toCurve: (run: number) => number,
): NonforcedPlannedResult => {
  checkDeadline();
  const decimals = settings.entry_send_time_decimals;
  const u0 = plan.u0;
  const clockStart = plan.clock_start_u;
  for (const [, entry] of plan.entries) {
    for (const move of entry.moves) {
      const curveTime = pythonRound(toCurve(clockStart), decimals);
      move.send_u = u0 + (curveTime - toCurve(u0)) * (reverse ? -1 : 1);
    }
  }
  const verification = verify(plan, settings);
  const entryMoves: NonforcedEntryMove[] = [];
  const byDevice = new Map<Device, Entry[]>();
  for (const [device, entry] of plan.entries) {
    checkDeadline();
    if (!byDevice.has(device)) byDevice.set(device, []);
    byDevice.get(device)!.push(entry);
    for (const move of entry.moves) {
      entryMoves.push({
        ...route(device),
        axis: entry.axis,
        axisIndex: entry.index,
        role: move.role,
        sendTime: pythonRound(toCurve(move.send_u), decimals),
        beforeJoinMs: pythonRound(u0 - move.send_u, decimals),
        ...move.move,
      });
    }
  }
  entryMoves.sort(
    (left, right) =>
      (reverse ? right.sendTime - left.sendTime : left.sendTime - right.sendTime) ||
      left.model_id - right.model_id ||
      left.axisIndex - right.axisIndex,
  );
  const deviceRows: NonforcedDeviceRow[] = [];
  for (const [device, entries] of byDevice) {
    const join: (number | null)[] = [null, null, null];
    const joinVelocity: (number | null)[] = [null, null, null];
    const axes: NonforcedAxisSummary[] = [];
    for (const entry of entries) {
      join[entry.index] = pythonRound(entry.join[0], 6);
      joinVelocity[entry.index] = pythonRound(entry.join[1], 6);
      const axis: NonforcedAxisSummary = { axis: entry.axis, kind: entry.kind, lead_ms: pythonRound(entry.lead_ms, 6) };
      if (entry.distance !== undefined) axis.distance = pythonRound(entry.distance, 6);
      if (entry.run_up_distance !== undefined) axis.run_up_distance = pythonRound(entry.run_up_distance, 6);
      axes.push(axis);
    }
    deviceRows.push({
      ...route(device),
      current_HPY: device.current,
      join_HPY: join,
      join_velocity_HPY: joinVelocity,
      axes,
    });
  }
  let selected = pythonRound(toCurve(u0), 6);
  if (Math.abs(selected - pythonRoundInt(selected)) < 1e-6) selected = pythonRoundInt(selected);
  const result: NonforcedPlannedResult = {
    status: verification.passed ? "planned" : "verification_failed",
    message: verification.passed ? "接入方案已生成，核对通过" : "接入方案核对未通过，请检查输入",
    algorithm_version: NONFORCED_ALGORITHM_VERSION,
    trajectory_run: false,
    reverse,
    selected_curve_time_ms: selected,
    clock_start_ms: pythonRound(toCurve(clockStart), decimals),
    entry_lead_ms: pythonRound(plan.lead_ms, decimals),
    frame_selection_mode: mode,
    reference_frame_ms: reference,
    reference_clamped: clamped,
    reference_segment_range_ms: referenceWindow,
    selected_segment_range_ms: selectedWindow,
    segment_search_attempts: attempts,
    candidates_evaluated: evaluated,
    max_skip_ms: mode === "current_segment_first" ? settings.entry_max_skip_ms : null,
    entry_moves: entryMoves,
    devices: deviceRows,
    execution: {
      rule:
        "曲线时钟从clock_start_ms开始走；时钟到entry_moves[].sendTime时给对应轴下发那条Move（每条只发一次）；" +
        "帧表中下发时刻早于selected_curve_time_ms的Move全部跳过，从selected_curve_time_ms起照帧表逐帧下发",
      relative:
        "也可按相对时间执行：GO后经过entry_lead_ms到达selected_curve_time_ms；" +
        "每条接入Move在到达前beforeJoinMs下发（clock_start_ms可能早于动作首帧，甚至为负）",
      reverse_clock: "反向时原曲线时钟从clock_start_ms往小走，sendTime都不小于selected_curve_time_ms",
      run_up_moves: entryMoves.filter((move) => move.role === "run_up").length,
      speed_factor: "按输入执行曲线和真实最大能力计算，结果直接发送；外部再变倍率须重新校验",
      mid_run_speed_change: "selected_curve_time_ms之前不做运行中调速",
    },
    verification: {
      max_position_error: pythonRound(verification.max_position_error, 9),
      max_velocity_error: pythonRound(verification.max_velocity_error, 9),
      entry_monotonic: verification.entry_monotonic,
      passed: verification.passed,
    },
  };
  if (settings.include_move_table) {
    result.move_table = devices.map((device) => ({
      ...route(device),
      axes: device.commands.map((commands) =>
        commands.map(({ atMs, target, velocity, acceleration, deceleration, passSpeed }) => ({
          atMs,
          target,
          velocity,
          acceleration,
          deceleration,
          passSpeed,
        })),
      ),
    }));
  }
  return result;
};
