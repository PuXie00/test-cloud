import { roundProjectCoordinate } from "../project-quantity";
import { axisMotionShape } from "./axis-motion";
import type { ResolvedAxisMotion } from "./resolve-sequence";

/**
 * 一条 move（汇川轮廓位置模式 / MC_MoveAbsolute，立即更新）：atMs 这一刻给轴下发
 * 目标位置、速度、加速度、减速度，驱动器自己按梯形走到目标并停下。
 *
 * 目标是这段连续运动最终停下的位置。中途不停的位姿不能当目标（驱动器会在那里停下），
 * 只在需要变速的时刻重新下发同一个目标、改速度：提速按加速度，降速按减速度；
 * 最后一条的减速度就是停到目标的减速度，驱动器到点自己开始减速。
 */
export type AxisMoveCommand = {
  /** 原曲线时刻，ms；反向运行时也是原曲线时刻 */
  atMs: number;
  target: number;
  /** 速度（绝对值） */
  velocity: number;
  acceleration: number;
  deceleration: number;
  /** 下发时轴应有的速度（绝对值）；0 表示从停止起步 */
  passSpeed: number;
  /**
   * 曲线这里降速太缓：照原降速率，驱动器会判定来不及停在目标、直接减速停车。
   * 已把减速度加大到不会提前停车，并放在曲线降速的中间下发，降完时位置和曲线重合。
   */
  adjusted?: boolean;
};

export type AxisMoveCommandOptions = {
  /** 反向运行：按原曲线倒着走，目标是每段连续运动的起点 */
  reverse?: boolean;
  /**
   * 循环序列：首尾以非 0 速度衔接时，末尾这段运动的目标在下一圈。
   * 只有 runMoveCommands 用（从 PLC 曲线还原，与 python 对数）；本软件解算的循环首尾总是停。
   */
  loop?: boolean;
};

/** 运行方向上的一个变速 / 匀速阶段；atMs 是阶段开始的原曲线时刻 */
type Phase = {
  atMs: number;
  fromSpeed: number;
  toSpeed: number;
  durationSec: number;
  distance: number;
  /** 循环首尾衔接处：下一圈从这里开始，补发一条，首圈和中途接入都能取到 */
  seam: boolean;
  /** 运行方向上原曲线时间的走向：顺向 1，反向 -1 */
  direction: 1 | -1;
  /** 太缓的降速拆成几级后，各级共用的减速度 */
  stepDeceleration?: number;
};

/**
 * 一个阶段对指令的要求。速度、加速度是定值；减速度在降速、停车阶段是定值，
 * 其余阶段只要求不小于 minDeceleration。
 *
 * 驱动器任何时刻都按 速度² ≤ 2 × 减速度 × 剩余距离 判断要不要开始停车，
 * minDeceleration 就是这个阶段里驱动器不提前停车所需的最小减速度。
 */
type PhaseNeed = {
  velocity: number;
  acceleration?: number;
  deceleration?: number;
  minDeceleration: number;
  adjusted: boolean;
  /** 比阶段开始晚多久下发（运行方向上的毫秒数），只有加大了减速度的降速会推迟 */
  delayMs?: number;
};

/** 一条指令管的连续几个阶段 */
type CommandWindow = PhaseNeed & { phases: Phase[] };

const SPEED_EPS = 1e-9;
const RATE_EPS = 1e-9;
/** 降速时减速度不够要加大，留 5% 余量，避免正好卡在驱动器判定的停车点 */
const SLOWDOWN_MARGIN = 1.05;

const sameValue = (left: number, right: number, eps: number) =>
  Math.abs(left - right) <= eps * Math.max(1, Math.abs(left), Math.abs(right));

/** 速度、加减速度保留 3 位小数：慢速旋转轴按工程坐标的 1 位小数会被取成 0 */
const KINEMATICS_FACTOR = 1000;

const roundSpeed = (value: number) => Math.round(value * KINEMATICS_FACTOR) / KINEMATICS_FACTOR;

/** 加减速度向上取整：只会比曲线更快变速，不会因取整来不及停在目标 */
const ceilRate = (value: number) =>
  Math.ceil(value * KINEMATICS_FACTOR - 1e-6) / KINEMATICS_FACTOR;

const isMoving = (motion: ResolvedAxisMotion) =>
  motion.to !== motion.from && motion.durationMs > 0 && motion.profile.kind === "trapezoid";

const forwardPhases = (motion: ResolvedAxisMotion): Phase[] => {
  const shape = axisMotionShape(motion);
  if (!shape) throw new Error("invalid trapezoid motion profile");
  const { startSpeed, cruiseSpeed, endSpeed, accelSec, cruiseSec, decelSec } = shape;
  return [
    { atMs: motion.startMs, fromSpeed: startSpeed, toSpeed: cruiseSpeed, durationSec: accelSec },
    { atMs: motion.startMs + accelSec * 1000, fromSpeed: cruiseSpeed, toSpeed: cruiseSpeed, durationSec: cruiseSec },
    { atMs: motion.endMs - decelSec * 1000, fromSpeed: cruiseSpeed, toSpeed: endSpeed, durationSec: decelSec },
  ]
    .filter((phase) => phase.durationSec > 0)
    .map((phase) => ({
      ...phase,
      distance: (phase.durationSec * (phase.fromSpeed + phase.toSpeed)) / 2,
      seam: false,
      direction: 1 as const,
    }));
};

/** 倒着走同一段：阶段倒序，起止速度互换，从原曲线的阶段末尾开始 */
const reversePhases = (motion: ResolvedAxisMotion): Phase[] =>
  forwardPhases(motion)
    .reverse()
    .map((phase) => ({
      atMs: phase.atMs + phase.durationSec * 1000,
      fromSpeed: phase.toSpeed,
      toSpeed: phase.fromSpeed,
      durationSec: phase.durationSec,
      distance: phase.distance,
      seam: false,
      direction: -1 as const,
    }));

/** 按原曲线时间排好的连续运动：前一段以非 0 速度离开、后一段以非 0 速度进入就是同一段 */
const groupRuns = (motions: readonly ResolvedAxisMotion[]): ResolvedAxisMotion[][] => {
  const runs: ResolvedAxisMotion[][] = [];
  for (const motion of motions) {
    const run = runs[runs.length - 1];
    const previous = run?.[run.length - 1];
    if (run && previous && previous.endSpeed > 0 && motion.startSpeed > 0 && previous.endMs === motion.startMs) {
      run.push(motion);
    } else {
      runs.push([motion]);
    }
  }
  return runs;
};

const isSlowdown = (phase: Phase) => phase.toSpeed < phase.fromSpeed - SPEED_EPS;
const rateOf = (phase: Phase) => Math.abs(phase.toSpeed - phase.fromSpeed) / phase.durationSec;

const stopNeed = (speed: number, distance: number) =>
  distance > 0 ? (speed * speed) / (2 * distance) : 0;

/** remaining[i]：阶段 i 开始时离目标的距离；laterDeceleration[i]：阶段 i 起曲线用到的最大减速度 */
const runProfile = (phases: readonly Phase[]) => {
  const remaining = phases.map(() => 0).concat(0);
  const laterDeceleration = phases.map(() => 0).concat(0);
  for (let index = phases.length - 1; index >= 0; index -= 1) {
    const phase = phases[index]!;
    remaining[index] = remaining[index + 1]! + phase.distance;
    const final = index === phases.length - 1;
    laterDeceleration[index] = Math.max(
      laterDeceleration[index + 1]!,
      final || isSlowdown(phase) ? rateOf(phase) : 0,
    );
  }
  return { remaining, laterDeceleration };
};

/** 驱动器不提前停车所需的最小减速度：开始和结束时各算一次 */
const slowdownNeed = (phase: Phase, remainingStart: number, remainingEnd: number) =>
  Math.max(stopNeed(phase.fromSpeed, remainingStart), stopNeed(phase.toSpeed, remainingEnd));

/** 推迟 (降速时长 - 降幅 / D) / 2 下发时仍满足 速度² × 余量 ≤ 2 × D × 剩余距离 的最小 D */
const centeredDeceleration = (phase: Phase, remaining: number) => {
  const speed = phase.fromSpeed;
  const spare = 2 * remaining - speed * phase.durationSec;
  if (!(spare > 0)) return Number.POSITIVE_INFINITY;
  return (SLOWDOWN_MARGIN * speed * speed - speed * (phase.fromSpeed - phase.toSpeed)) / spare;
};

/**
 * 降速太缓、要加大减速度 D 时，推迟到曲线降速的中间下发（两段降速对称，降完时位置重合）。
 * D 取能完全居中的最小值，但不超过后面曲线自己用到的最大减速度；
 * 推迟期间仍是上一条指令在管，推迟量也受它的减速度限制，放不下就少推迟一些。
 */
const raiseSlowdown = (
  phase: Phase,
  remaining: number,
  atEnd: number,
  ceiling: number,
  previous: PhaseNeed | undefined,
) => {
  const speed = phase.fromSpeed;
  const drop = phase.fromSpeed - phase.toSpeed;
  const rampSec = phase.durationSec;
  const deceleration =
    phase.stepDeceleration ??
    Math.max(rateOf(phase), atEnd, Math.min(centeredDeceleration(phase, remaining), ceiling));
  const centerSec = (rampSec - drop / deceleration) / 2;
  const ownSec = (remaining - (SLOWDOWN_MARGIN * speed * speed) / (2 * deceleration)) / speed;
  const previousSec =
    previous?.deceleration !== undefined
      ? (remaining - (speed * speed * (1 + RATE_EPS)) / (2 * previous.deceleration)) / speed
      : Number.POSITIVE_INFINITY;
  const delaySec = previous ? Math.max(0, Math.min(centerSec, ownSec, previousSec)) : 0;
  return {
    deceleration,
    delayMs: delaySec * 1000,
    previousNeed: stopNeed(speed, remaining - speed * delaySec),
    deviation: (drop * Math.max(0, rampSec - drop / deceleration)) / 8,
  };
};

/** 加大了减速度的降速在过程中与曲线的偏差，超过这个值就拆成几级（单位同轴坐标） */
const SLOWDOWN_TOLERANCE = 0.1;
/** 一次降速最多拆几级：每级偏差按级数平方缩小 */
const MAX_SLOWDOWN_STEPS = 5;

/**
 * 太缓的降速拆成几小级、每级居中下发：速度呈台阶，偏差按级数平方缩小，
 * 降完时位置仍与曲线重合。
 */
const splitGentleSlowdowns = (phases: readonly Phase[]): Phase[] => {
  const { remaining, laterDeceleration } = runProfile(phases);
  return phases.flatMap((phase, index) => {
    if (index === phases.length - 1 || !isSlowdown(phase)) return [phase];
    const atEnd = stopNeed(phase.toSpeed, remaining[index + 1]!);
    if (rateOf(phase) >= slowdownNeed(phase, remaining[index]!, remaining[index + 1]!) * (1 + RATE_EPS)) {
      return [phase];
    }
    const { deviation } = raiseSlowdown(phase, remaining[index]!, atEnd, laterDeceleration[index]!, undefined);
    const steps = Math.min(MAX_SLOWDOWN_STEPS, Math.max(1, Math.ceil(Math.sqrt(deviation / SLOWDOWN_TOLERANCE))));
    if (steps === 1) return [phase];
    const drop = (phase.fromSpeed - phase.toSpeed) / steps;
    const durationSec = phase.durationSec / steps;
    const parts: Phase[] = Array.from({ length: steps }, (_, step) => {
      const fromSpeed = phase.fromSpeed - drop * step;
      const toSpeed = step === steps - 1 ? phase.toSpeed : fromSpeed - drop;
      return {
        atMs: phase.atMs + phase.direction * durationSec * 1000 * step,
        fromSpeed,
        toSpeed,
        durationSec,
        distance: (durationSec * (fromSpeed + toSpeed)) / 2,
        seam: phase.seam && step === 0,
        direction: phase.direction,
      };
    });
    // 各级共用一个减速度：取各级完全居中所需的最大值，前一级就能管住后一级推迟的那段
    let before = remaining[index]!;
    let shared = Math.max(rateOf(phase), atEnd);
    for (const part of parts) {
      shared = Math.max(shared, centeredDeceleration(part, before), stopNeed(part.toSpeed, before - part.distance));
      before -= part.distance;
    }
    const stepDeceleration = Math.min(shared, laterDeceleration[index]!);
    return parts.map((part) => ({ ...part, stepDeceleration }));
  });
};

/**
 * 各阶段对指令的要求（phases 是一段连续运动，最后一段停到目标）：
 * - 提速：速度 = 段末速度，加速度 = 曲线的提速率；
 * - 降速：速度 = 段末速度，减速度 = 曲线的降速率。降速率比驱动器不提前停车所需的还小时
 *   （降得很缓、离目标又不远），按 raiseSlowdown 加大并推迟下发，标记 adjusted；
 * - 匀速：速度不变；
 * - 停到目标：速度 = 进入时的速度，减速度 = 停车减速度，驱动器到点自己减速。
 *
 * 后面各段的减速都不超过 D 时，从任一时刻到目标都满足 速度² ≤ 2 × D × 剩余距离，
 * 所以 minDeceleration 不会超过后面的最大减速度。
 */
const phaseNeeds = (phases: readonly Phase[]): PhaseNeed[] => {
  const { remaining, laterDeceleration } = runProfile(phases);
  const needs: PhaseNeed[] = [];
  phases.forEach((phase, index) => {
    const rate = rateOf(phase);
    if (index === phases.length - 1) {
      needs.push({ velocity: phase.fromSpeed, deceleration: rate, minDeceleration: 0, adjusted: false });
      return;
    }
    const atEnd = stopNeed(phase.toSpeed, remaining[index + 1]!);
    if (phase.toSpeed > phase.fromSpeed + SPEED_EPS) {
      needs.push({ velocity: phase.toSpeed, acceleration: rate, minDeceleration: atEnd, adjusted: false });
      return;
    }
    if (!isSlowdown(phase)) {
      needs.push({ velocity: phase.fromSpeed, minDeceleration: atEnd, adjusted: false });
      return;
    }
    const needed = slowdownNeed(phase, remaining[index]!, remaining[index + 1]!);
    if (rate >= needed * (1 + RATE_EPS)) {
      needs.push({ velocity: phase.toSpeed, deceleration: rate, minDeceleration: needed, adjusted: false });
      return;
    }
    const previous = phase.seam ? undefined : needs[index - 1];
    const raised = raiseSlowdown(phase, remaining[index]!, atEnd, laterDeceleration[index]!, previous);
    if (previous) previous.minDeceleration = Math.max(previous.minDeceleration, raised.previousNeed);
    needs.push({
      velocity: phase.toSpeed,
      deceleration: raised.deceleration,
      minDeceleration: needed,
      adjusted: true,
      ...(raised.delayMs > 0 ? { delayMs: raised.delayMs } : {}),
    });
  });
  return needs;
};

const decelerationFits = (window: PhaseNeed, need: PhaseNeed) => {
  const tolerance = 1 - RATE_EPS;
  if (window.deceleration !== undefined && need.deceleration !== undefined) {
    return sameValue(window.deceleration, need.deceleration, RATE_EPS);
  }
  if (window.deceleration !== undefined) return window.deceleration >= need.minDeceleration * tolerance;
  if (need.deceleration !== undefined) return need.deceleration >= window.minDeceleration * tolerance;
  return true;
};

/** 相邻阶段能共用一条指令就合并；速度、加速度、减速度有一个对不上就另起一条 */
const commandWindows = (phases: readonly Phase[]): CommandWindow[] => {
  const needs = phaseNeeds(phases);
  const windows: CommandWindow[] = [];
  phases.forEach((phase, index) => {
    const need = needs[index]!;
    const current = windows[windows.length - 1];
    const fits =
      current !== undefined &&
      !phase.seam &&
      sameValue(current.velocity, need.velocity, SPEED_EPS) &&
      (need.acceleration === undefined ||
        current.acceleration === undefined ||
        sameValue(current.acceleration, need.acceleration, RATE_EPS)) &&
      decelerationFits(current, need);
    if (!fits) {
      windows.push({ ...need, phases: [phase] });
      return;
    }
    current.phases.push(phase);
    current.acceleration ??= need.acceleration;
    current.deceleration ??= need.deceleration;
    current.minDeceleration = Math.max(current.minDeceleration, need.minDeceleration);
    current.adjusted ||= need.adjusted;
  });
  return windows;
};

/**
 * 补齐没被曲线定下来的加减速度：
 * - 减速度：取后面各条指令里最大的减速度（至少满足本条的下限）。驱动器只会在最后一条
 *   到点时开始停车；中途某条下发晚了，也是按曲线自己用过的减速度停在目标。
 * - 加速度：沿用前面最近一次的加速度（中途接入从静止起步也用得上），没有就取后面的。
 */
const settleRates = (windows: CommandWindow[]): void => {
  let laterDeceleration = 0;
  for (let index = windows.length - 1; index >= 0; index -= 1) {
    const window = windows[index]!;
    window.deceleration ??= Math.max(window.minDeceleration, laterDeceleration);
    laterDeceleration = Math.max(laterDeceleration, window.deceleration);
  }
  let previousAcceleration = windows.find((window) => window.acceleration !== undefined)?.acceleration;
  for (const window of windows) {
    window.acceleration ??= previousAcceleration ?? window.deceleration;
    previousAcceleration = window.acceleration;
  }
};

const runCommands = (phases: readonly Phase[], target: number): AxisMoveCommand[] => {
  const windows = commandWindows(splitGentleSlowdowns(phases));
  settleRates(windows);
  const commands = windows.map((window) => {
    const first = window.phases[0]!;
    return {
      atMs: roundProjectCoordinate(first.atMs + first.direction * (window.delayMs ?? 0)),
      target: roundProjectCoordinate(target),
      velocity: roundSpeed(window.velocity),
      acceleration: ceilRate(window.acceleration ?? 0),
      deceleration: ceilRate(window.deceleration ?? 0),
      passSpeed: roundSpeed(first.fromSpeed),
      ...(window.adjusted ? { adjusted: true } : {}),
    };
  });
  // 时刻取整后撞在一起的，保留运行方向上后下发的那条
  return commands.filter((command, index) => commands[index + 1]?.atMs !== command.atMs);
};

/**
 * 一个轴整条序列的 move 指令，按原曲线时刻升序。motions 是该轴依次跟随的曲线
 * （objectAxisMotions），停留段不出指令。反向运行时指令按倒走的曲线生成，
 * 时刻仍是原曲线时刻：从末尾往前，原曲线时钟走到 atMs 时下发。
 * 解算出的曲线首尾总是停（循环序列也是），所以这里不需要跨圈衔接。
 */
export const axisMoveCommands = (
  motions: readonly ResolvedAxisMotion[],
  options: Pick<AxisMoveCommandOptions, "reverse"> = {},
): AxisMoveCommand[] => {
  const commands = groupRuns(motions.filter(isMoving)).flatMap((run) => {
    if (options.reverse) {
      const phases = run
        .map(reversePhases)
        .reverse()
        .flat();
      return runCommands(phases, run[0]!.from);
    }
    const phases = run.flatMap(forwardPhases);
    return runCommands(phases, run[run.length - 1]!.to);
  });
  return commands.sort((left, right) => left.atMs - right.atMs);
};

/**
 * 一段连续运动（中途不停）：恒加速度阶段的原曲线起止时刻、起止速度（绝对值），
 * 以及起点、终点位置和进入、离开的速度。
 */
export type AxisMoveRun = {
  phases: readonly { startMs: number; endMs: number; fromSpeed: number; toSpeed: number }[];
  startPos: number;
  endPos: number;
  startSpeed: number;
  endSpeed: number;
};

/**
 * 与 axisMoveCommands 同一规则，输入换成已经分好的连续运动。
 * 非强制就近接入从下发 PLC 的曲线系数还原帧表时用，对应 python/非强制就近接入.py 的 axis_move_commands。
 */
export const runMoveCommands = (
  runs: readonly AxisMoveRun[],
  options: AxisMoveCommandOptions = {},
): AxisMoveCommand[] => {
  const tail = runs[runs.length - 1];
  const head = runs[0];
  const seamJoined =
    options.loop === true && runs.length > 1 && tail!.endSpeed > 0 && head!.startSpeed > 0;
  const joined: { run: Pick<AxisMoveRun, "phases" | "startPos" | "endPos">; seamAt: number }[] = seamJoined
    ? [
        {
          run: { phases: [...tail!.phases, ...head!.phases], startPos: tail!.startPos, endPos: head!.endPos },
          seamAt: tail!.phases.length,
        },
        ...runs.slice(1, -1).map((run) => ({ run, seamAt: -1 })),
      ]
    : runs.map((run) => ({ run, seamAt: -1 }));
  const commands = joined.flatMap(({ run, seamAt }) => {
    if (options.reverse) {
      const phases: Phase[] = [];
      for (let index = run.phases.length - 1; index >= 0; index -= 1) {
        const { startMs, endMs, fromSpeed, toSpeed } = run.phases[index]!;
        const durationSec = (endMs - startMs) / 1000;
        phases.push({
          atMs: startMs + durationSec * 1000,
          fromSpeed: toSpeed,
          toSpeed: fromSpeed,
          durationSec,
          distance: (durationSec * (toSpeed + fromSpeed)) / 2,
          seam: index === seamAt - 1,
          direction: -1,
        });
      }
      return runCommands(phases, run.startPos);
    }
    const phases = run.phases.map(({ startMs, endMs, fromSpeed, toSpeed }, index): Phase => {
      const durationSec = (endMs - startMs) / 1000;
      return {
        atMs: startMs,
        fromSpeed,
        toSpeed,
        durationSec,
        distance: (durationSec * (fromSpeed + toSpeed)) / 2,
        seam: index === seamAt,
        direction: 1,
      };
    });
    return runCommands(phases, run.endPos);
  });
  return commands.sort((left, right) => left.atMs - right.atMs);
};
