import { describe, expect, it } from "vitest";
import { evaluateResolvedSequence } from "./evaluate-sequence";
import { axisMoveCommands, type AxisMoveCommand } from "./move-commands";
import { objectAxisMotions, resolveActionSequence } from "./resolve-sequence";
import type { ActionSequenceConfig, KeyframePose, MotionProfile, PoseBlock } from "./types";
import { hasBlockingSequenceIssues, validateActionSequence } from "./validate-sequence";

const pose = (
  id: string,
  atMs: number,
  value: KeyframePose,
  passSpeeds?: PoseBlock["passSpeeds"],
): PoseBlock => ({
  id,
  kind: "pose",
  objectId: 1,
  atMs,
  pose: value,
  ...(passSpeeds ? { passSpeeds } : {}),
});

const trap = (accelMs: number, decelMs: number): MotionProfile => ({
  kind: "trapezoid",
  params: { accelMs, decelMs },
});

const sequenceOf = (
  blocks: PoseBlock[],
  extra: Partial<ActionSequenceConfig> = {},
): ActionSequenceConfig => ({
  id: 1,
  name: "move",
  trajectoryMode: false,
  blocks,
  segments: [],
  ...extra,
});

const v1MotionsOf = (sequence: ActionSequenceConfig) => {
  const resolved = resolveActionSequence(sequence);
  return objectAxisMotions(
    resolved.segments.filter((segment) => segment.objectId === 1),
    "v1",
  );
};

const planAt = (sequence: ActionSequenceConfig, atMs: number) =>
  evaluateResolvedSequence(resolveActionSequence(sequence), atMs).get(1)!.v1;

/** 同一条序列反复取值时只解析一次 */
const planOf = (sequence: ActionSequenceConfig) => {
  const resolved = resolveActionSequence(sequence);
  return (atMs: number) => evaluateResolvedSequence(resolved, atMs).get(1)!.v1;
};

/**
 * 驱动器轮廓位置模式（立即更新）的位置规划：朝目标按加速度提到速度、按减速度降到速度，
 * 剩余距离只够按减速度停下时开始减速停在目标。按事件精确积分。
 * waitForStandstill：passSpeed 为 0 的指令（从静止起步）等轴停在上一个目标后再发。
 */
type DriveCommand = Pick<
  AxisMoveCommand,
  "target" | "velocity" | "acceleration" | "deceleration"
> & { atSec: number; passSpeed?: number };

type Piece = { t: number; x: number; v: number; a: number };

const simulateDrive = (
  commands: readonly DriveCommand[],
  startX: number,
  untilSec: number,
  waitForStandstill = false,
) => {
  const pieces: Piece[] = [];
  let x = startX;
  let v = 0;
  let t = commands[0]?.atSec ?? 0;
  /** 停车时实际需要的减速度 / 指令减速度；> 1 就是来不及停、会冲过目标 */
  let worstBrakeRatio = 0;
  pieces.push({ t: Number.NEGATIVE_INFINITY, x, v: 0, a: 0 });
  const follow = (command: DriveCommand, endSec: number) => {
    const { target, velocity: V, acceleration: A, deceleration: D } = command;
    for (let guard = 0; t < endSec - 1e-12 && guard < 100; guard += 1) {
      // 停车正好落在下一条指令的时刻时，积分会留下极小的残余速度
      if (Math.abs(v) < 1e-6) v = 0;
      if (Math.abs(target - x) < 1e-6 && Math.abs(v) < 1e-5 * Math.max(1, V)) {
        x = target;
        v = 0;
      }
      const dx = target - x;
      const s = dx !== 0 ? Math.sign(dx) : Math.sign(v);
      if (s === 0) {
        pieces.push({ t, x, v: 0, a: 0 });
        if (Number.isFinite(endSec)) t = endSec;
        return;
      }
      const u = v * s;
      const rem = Math.abs(dx);
      let accel: number;
      let tau: number;
      let braking = false;
      if (u < 0) {
        accel = D;
        tau = -u / D;
      } else if (rem <= (u * u) / (2 * D) * (1 + 1e-9) + 1e-9) {
        braking = true;
        const needed = (u * u) / (2 * rem);
        worstBrakeRatio = Math.max(worstBrakeRatio, needed / D);
        accel = -needed;
        tau = (2 * rem) / u;
      } else if (u > V + 1e-9) {
        accel = -D;
        tau = (u - V) / D;
      } else if (u < V - 1e-9) {
        accel = A;
        const k = (rem - (u * u) / (2 * D)) / (1 + A / D);
        tau = Math.min((V - u) / A, (-u + Math.sqrt(u * u + 2 * A * k)) / A);
      } else {
        accel = 0;
        tau = (rem - (u * u) / (2 * D)) / u;
      }
      const step = Math.min(tau, endSec - t);
      pieces.push({ t, x, v, a: accel * s });
      x += s * (u * step + (accel * step * step) / 2);
      v = s * (u + accel * step);
      t += step;
      if (step === tau) {
        if (braking) {
          x = target;
          v = 0;
        } else if (accel !== 0 && u >= 0 && Math.abs(Math.abs(v) - V) < 1e-6) {
          // 到了这一档速度，按精确值继续，免得浮点来回
          v = s * V;
        }
      }
    }
  };
  let previous: DriveCommand | undefined;
  commands.forEach((command, index) => {
    if (waitForStandstill && command.passSpeed === 0 && previous) {
      follow(previous, Number.POSITIVE_INFINITY);
    }
    t = Math.max(t, command.atSec);
    follow(command, Math.max(commands[index + 1]?.atSec ?? untilSec, t));
    previous = command;
  });
  pieces.push({ t, x, v: 0, a: 0 });
  const positionAt = (sec: number) => {
    let piece = pieces[0]!;
    for (const candidate of pieces) {
      if (candidate.t <= sec) piece = candidate;
      else break;
    }
    const dt = sec - piece.t;
    if (!Number.isFinite(dt)) return piece.x;
    return piece.x + piece.v * dt + (piece.a * dt * dt) / 2;
  };
  return { positionAt, worstBrakeRatio, endX: x };
};

/** 浮点和取整的余量：停车所需减速度最多比指令大这么一点 */
const BRAKE_RATIO_LIMIT = 1 + 1e-3;

/** 固定种子的随机序列：位姿、时间、加减速、手填经过速度、停留都随机 */
const randomSequences = (count: number) => {
  let seed = 20261107;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const sequences: ActionSequenceConfig[] = [];
  while (sequences.length < count) {
    const blocks: PoseBlock[] = [];
    const segments: ActionSequenceConfig["segments"] = [];
    let atMs = 0;
    let value = 0;
    const poses = 3 + Math.floor(random() * 6);
    for (let index = 0; index < poses; index += 1) {
      if (index > 0) {
        atMs += 500 + Math.round(random() * 3500);
        if (random() > 0.15) value = Math.round(random() * 4000 - 2000);
      }
      const manual = index > 0 && index < poses - 1 && random() < 0.2;
      blocks.push(pose(`p${index}`, atMs, { v1: value }, manual ? { v1: Math.round(random() * 600) } : undefined));
      if (index > 0 && random() < 0.5) {
        const span = atMs - blocks[index - 1]!.atMs;
        const accelMs = Math.max(1, Math.round(span * (0.05 + random() * 0.4)));
        const decelMs = Math.max(1, Math.round(span * (0.05 + random() * 0.4)));
        if (accelMs + decelMs < span) {
          segments.push({
            fromRef: `p${index - 1}`,
            toRef: `p${index}`,
            settings: { profiles: { v1: trap(accelMs, decelMs), v2: { kind: "idle" }, v3: { kind: "idle" } } },
          });
        }
      }
    }
    const sequence = sequenceOf(blocks, { segments });
    const issues = validateActionSequence(sequence, {
      objects: [{ id: 1, enabledVirtualAxes: ["v1"], limits: { v1: { min: -1e6, max: 1e6, maxVelocity: 1e6, minAccelTime: 0.001 } } }],
    });
    if (!hasBlockingSequenceIssues(issues)) sequences.push(sequence);
  }
  return sequences;
};

/** 顺向：从首帧静止开始跑完整条，逐 5ms 对比曲线 */
const forwardDeviation = (sequence: ActionSequenceConfig, scale = 1) => {
  const motions = v1MotionsOf(sequence);
  const commands = axisMoveCommands(motions);
  const startMs = motions[0]!.startMs;
  const endMs = motions[motions.length - 1]!.endMs;
  const drive = commands.map((command) => ({
    atSec: command.atMs / 1000 / scale,
    target: command.target,
    velocity: command.velocity * scale,
    acceleration: command.acceleration * scale * scale,
    deceleration: command.deceleration * scale * scale,
  }));
  const sim = simulateDrive(drive, planAt(sequence, startMs), (endMs + 2000) / 1000 / scale);
  let worst = 0;
  for (let atMs = startMs; atMs <= endMs + 1000; atMs += 5) {
    worst = Math.max(worst, Math.abs(sim.positionAt(atMs / 1000 / scale) - planAt(sequence, atMs)));
  }
  return { worst, sim, commands };
};

// 0–4s 慢速走到 400，4–6s 快速走到 1000：400 处不停，提速经过
const slowFast = [pose("p0", 0, { v1: 0 }), pose("p1", 4000, { v1: 400 }), pose("p2", 6000, { v1: 1000 })];
// 先快后慢：400 处降速经过
const fastSlow = [pose("p0", 0, { v1: 0 }), pose("p1", 2000, { v1: 600 }), pose("p2", 6000, { v1: 1000 })];
const alternating = [
  pose("p0", 0, { v1: 0 }),
  pose("p1", 4000, { v1: 400 }),
  pose("p2", 6000, { v1: 1000 }),
  pose("p3", 8000, { v1: 1700 }),
  pose("p4", 10000, { v1: 1900 }),
];

describe("axisMoveCommands", () => {
  it("drives a single span with one move to its end pose", () => {
    const sequence = sequenceOf([pose("a", 1000, { v1: 0 }), pose("b", 2000, { v1: 1000 })], {
      segments: [{
        fromRef: "a",
        toRef: "b",
        settings: { profiles: { v1: trap(150, 250), v2: trap(150, 250), v3: trap(150, 250) } },
      }],
    });
    const { worst, commands, sim } = forwardDeviation(sequence);
    // 匀速 1000 / (1 - 0.075 - 0.125) = 1250
    expect(commands).toEqual([{
      atMs: 1000,
      target: 1000,
      velocity: 1250,
      acceleration: 8333.334,
      deceleration: 5000,
      passSpeed: 0,
    }]);
    expect(worst).toBeLessThan(0.01);
    expect(sim.endX).toBe(1000);
    expect(sim.worstBrakeRatio).toBeLessThanOrEqual(BRAKE_RATIO_LIMIT);
  });

  it("never targets a pose the axis passes without stopping", () => {
    for (const blocks of [slowFast, fastSlow, alternating]) {
      const commands = axisMoveCommands(v1MotionsOf(sequenceOf(blocks)));
      const end = blocks[blocks.length - 1]!.pose.v1;
      expect(commands.length).toBeGreaterThan(1);
      expect(commands.every((command) => command.target === end)).toBe(true);
    }
  });

  it("speeds up through a pose by re-sending the same target with a higher speed", () => {
    const { worst, commands, sim } = forwardDeviation(sequenceOf(slowFast));
    // 起步、到 400 前提到经过速度 150、过 400 后提到快段匀速
    expect(commands.map((command) => command.atMs)).toEqual([0, 3200, 4000]);
    expect(commands.map((command) => command.passSpeed)).toEqual([0, 106.25, 150]);
    expect(commands[1]!.velocity).toBe(150);
    expect(commands[2]!.velocity).toBeCloseTo(356.25, 3);
    expect(worst).toBeLessThan(0.01);
    expect(sim.endX).toBe(1000);
    expect(sim.worstBrakeRatio).toBeLessThanOrEqual(BRAKE_RATIO_LIMIT);
  });

  it("slows down through a pose with the curve's deceleration", () => {
    const { worst, commands, sim } = forwardDeviation(sequenceOf(fastSlow));
    expect(commands.some((command) => command.adjusted)).toBe(false);
    expect(commands.slice(1).every((command) => command.velocity < commands[0]!.velocity)).toBe(true);
    expect(worst).toBeLessThan(0.01);
    expect(sim.endX).toBe(1000);
    expect(sim.worstBrakeRatio).toBeLessThanOrEqual(BRAKE_RATIO_LIMIT);
  });

  it("follows alternating fast and slow spans", () => {
    const { worst, sim } = forwardDeviation(sequenceOf(alternating));
    expect(worst).toBeLessThan(0.01);
    expect(sim.endX).toBe(1900);
    expect(sim.worstBrakeRatio).toBeLessThanOrEqual(BRAKE_RATIO_LIMIT);
  });

  it("stops at holds and reversals: each stop is a target of its own", () => {
    const sequence = sequenceOf([
      pose("p0", 0, { v1: 0 }),
      pose("p1", 2000, { v1: 500 }),
      pose("p2", 3000, { v1: 500 }),
      pose("p3", 5000, { v1: 800 }),
      pose("p4", 7000, { v1: 200 }),
    ]);
    const { worst, commands, sim } = forwardDeviation(sequence);
    expect(commands.map((command) => [command.atMs, command.target])).toEqual([
      [0, 500],
      [3000, 800],
      [5000, 200],
    ]);
    expect(worst).toBeLessThan(0.01);
    expect(sim.endX).toBe(200);
  });

  it("treats an axis left unset on the middle pose as one move", () => {
    const sequence = sequenceOf([
      pose("p0", 0, { v1: 0, v2: 0 }),
      pose("p1", 2000, { v2: 10 }),
      pose("p2", 4000, { v1: 1000, v2: 20 }),
    ]);
    const { worst, commands } = forwardDeviation(sequence);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.target).toBe(1000);
    expect(worst).toBeLessThan(0.01);
  });

  it("honours manual pass speeds, including one above the cruise speed", () => {
    const sequence = sequenceOf([
      pose("p0", 0, { v1: 0 }),
      pose("p1", 3000, { v1: 600 }, { v1: 320 }),
      pose("p2", 6000, { v1: 1200 }),
    ]);
    const { worst, sim } = forwardDeviation(sequence);
    expect(worst).toBeLessThan(0.01);
    expect(sim.worstBrakeRatio).toBeLessThanOrEqual(BRAKE_RATIO_LIMIT);
  });

  it("scales exactly with the speed factor: time / k, speed × k, accel × k²", () => {
    for (const scale of [0.25, 0.5, 2, 3]) {
      for (const blocks of [slowFast, fastSlow, alternating]) {
        const { worst, sim } = forwardDeviation(sequenceOf(blocks), scale);
        expect(worst).toBeLessThan(0.01);
        expect(sim.worstBrakeRatio).toBeLessThanOrEqual(BRAKE_RATIO_LIMIT);
      }
    }
  });

  it("runs backwards from the end: targets are run starts, times stay on the original curve", () => {
    const sequence = sequenceOf(alternating);
    const motions = v1MotionsOf(sequence);
    const commands = axisMoveCommands(motions, { reverse: true });
    expect(commands.every((command) => command.target === 0)).toBe(true);
    expect(commands[commands.length - 1]!.atMs).toBe(10000);
    expect(commands[commands.length - 1]!.passSpeed).toBe(0);
    // 倒着下发：原曲线时钟从 10000 走到 atMs 时下发
    const endMs = 10000;
    const drive = [...commands].reverse().map((command) => ({
      ...command,
      atSec: (endMs - command.atMs) / 1000,
    }));
    const sim = simulateDrive(drive, 1900, 12);
    const gap = (runMs: number) => Math.abs(sim.positionAt(runMs / 1000) - planAt(sequence, endMs - runMs));
    let worst = 0;
    for (let runMs = 0; runMs <= endMs; runMs += 5) worst = Math.max(worst, gap(runMs));
    // 正向在 p2 前略微提速进位姿，倒过来是很缓的降速：照原降速率驱动器会判定停不住，
    // 只能加大减速度、分级居中下发，降速过程中差不到 0.1 mm，降完即重合
    expect(commands.some((command) => command.adjusted)).toBe(true);
    expect(worst).toBeLessThan(0.1);
    for (const block of alternating) expect(gap(endMs - block.atMs)).toBeLessThan(0.01);
    expect(sim.endX).toBe(0);
    expect(sim.worstBrakeRatio).toBeLessThanOrEqual(BRAKE_RATIO_LIMIT);
  });

  it("carries a loop seam crossed at speed into the next lap", () => {
    // 0 ↑500 ↓-500 ↑0：末段和首段都向上，首尾以 250 衔接，末尾这段的目标是下一圈的 500
    const sequence = sequenceOf(
      [
        pose("p0", 0, { v1: 0 }),
        pose("p1", 2000, { v1: 500 }),
        pose("p2", 6000, { v1: -500 }),
        pose("p3", 8000, { v1: 0 }),
      ],
      { loop: true },
    );
    const commands = axisMoveCommands(v1MotionsOf(sequence), { loop: true });
    expect(commands[0]).toMatchObject({ atMs: 0, target: 500, passSpeed: 250 });
    expect(commands.filter((command) => command.target === 500).length).toBeGreaterThan(1);
    expect(commands.filter((command) => command.atMs > 6000).every((command) => command.target === 500)).toBe(true);

    const period = 8000;
    const laps = [0, 1, 2].flatMap((lap) =>
      commands.map((command) => ({ ...command, atSec: (command.atMs + lap * period) / 1000 })),
    );
    // 首圈从静止起步；第二圈起应与曲线一致
    const sim = simulateDrive(laps, 0, (3 * period) / 1000);
    let worst = 0;
    for (let atMs = period; atMs < 3 * period; atMs += 5) {
      worst = Math.max(worst, Math.abs(sim.positionAt(atMs / 1000) - planAt(sequence, atMs % period)));
    }
    expect(worst).toBeLessThan(0.01);
    expect(sim.worstBrakeRatio).toBeLessThanOrEqual(BRAKE_RATIO_LIMIT);

    // 反向循环：倒走时末尾 8000 处补发一条，越过首尾的那段目标是上一圈的 -500
    const backwards = axisMoveCommands(v1MotionsOf(sequence), { loop: true, reverse: true });
    expect(backwards[backwards.length - 1]).toMatchObject({ atMs: 8000, target: -500, passSpeed: 250 });
    const reverseLaps = [0, 1, 2].flatMap((lap) =>
      [...backwards].reverse().map((command) => ({
        ...command,
        atSec: (period - command.atMs + lap * period) / 1000,
      })),
    );
    const reverseSim = simulateDrive(reverseLaps, 0, (3 * period) / 1000);
    let reverseWorst = 0;
    for (let runMs = period; runMs < 3 * period; runMs += 5) {
      const curveMs = period - (runMs % period);
      reverseWorst = Math.max(
        reverseWorst,
        Math.abs(reverseSim.positionAt(runMs / 1000) - planAt(sequence, curveMs === period ? 0 : curveMs)),
      );
    }
    expect(reverseWorst).toBeLessThan(0.01);
    expect(reverseSim.worstBrakeRatio).toBeLessThanOrEqual(BRAKE_RATIO_LIMIT);
  });

  it("raises a slowdown too gentle to stop in time, so the drive never overshoots", () => {
    // 快段 0→1000 用 1.1s，慢段 1000→1500 用 0.7s 且最后急停：进入慢段时只降一点点速度，
    // 照这个降速率驱动器会判定停不住
    const sequence = sequenceOf([
      pose("p0", 0, { v1: 0 }),
      pose("p1", 1100, { v1: 1000 }),
      pose("p2", 1800, { v1: 1500 }),
    ]);
    const { worst, commands, sim } = forwardDeviation(sequence);
    expect(commands.some((command) => command.adjusted)).toBe(true);
    expect(sim.worstBrakeRatio).toBeLessThanOrEqual(BRAKE_RATIO_LIMIT);
    expect(sim.endX).toBe(1500);
    // 降速过程中差一点，经过 1000 时已和曲线重合
    expect(worst).toBeLessThan(0.5);
    expect(Math.abs(sim.positionAt(1.1) - 1000)).toBeLessThan(0.01);
  });

  it("follows random sequences forwards, backwards and at other speeds", () => {
    let worstAtPose = 0;
    let worstOverall = 0;
    for (const sequence of randomSequences(150)) {
      const motions = v1MotionsOf(sequence);
      const plan = planOf(sequence);
      const blocks = sequence.blocks as PoseBlock[];
      const endMs = blocks[blocks.length - 1]!.atMs;
      for (const reverse of [false, true]) {
        const commands = axisMoveCommands(motions, { reverse });
        const ordered = reverse ? [...commands].reverse() : commands;
        const curveAt = (runMs: number) => plan(reverse ? endMs - runMs : runMs);
        for (const scale of [1, 0.5, 2.5]) {
          const drive = ordered.map((command) => ({
            atSec: (reverse ? endMs - command.atMs : command.atMs) / 1000 / scale,
            target: command.target,
            velocity: command.velocity * scale,
            acceleration: command.acceleration * scale * scale,
            deceleration: command.deceleration * scale * scale,
          }));
          const sim = simulateDrive(drive, curveAt(0), (endMs + 3000) / 1000 / scale);
          expect(sim.worstBrakeRatio).toBeLessThanOrEqual(BRAKE_RATIO_LIMIT);
          expect(sim.endX).toBeCloseTo(curveAt(endMs), 6);
          for (let runMs = 0; runMs <= endMs; runMs += 20) {
            worstOverall = Math.max(worstOverall, Math.abs(sim.positionAt(runMs / 1000 / scale) - curveAt(runMs)));
          }
          for (const block of blocks) {
            const runMs = reverse ? endMs - block.atMs : block.atMs;
            worstAtPose = Math.max(worstAtPose, Math.abs(sim.positionAt(runMs / 1000 / scale) - curveAt(runMs)));
          }
        }
      }
    }
    // 位姿时刻都在曲线上；过程偏差只出在无法照原降速率执行的缓降里
    expect(worstAtPose).toBeLessThan(0.01);
    expect(worstOverall).toBeLessThan(0.5);
  });

  it("stays safe when the speed factor changes mid-run under the C++ rules", () => {
    // 运行中 k1 → k2：剩余指令按 k2 排时间；当前这条立刻按 k2 重发，当前这段运动的减速度用
    // max(k1, k2)² 缩放且只增不减；passSpeed 为 0 的指令等轴停稳再发。
    // 照朴素的 k2² 缩放减速度会冲过目标。
    const changes = [[2, 0.5], [1, 0.3], [3, 1], [0.5, 2], [1, 3]] as const;
    let naiveOvershoots = 0;
    let index = 0;
    for (const sequence of randomSequences(120)) {
      const commands = axisMoveCommands(v1MotionsOf(sequence));
      const blocks = sequence.blocks as PoseBlock[];
      const endMs = blocks[blocks.length - 1]!.atMs;
      for (const [k1, k2] of changes) {
        index += 1;
        const changeMs = ((index * 7919) % 1000) / 1000 * endMs;
        const changeSec = changeMs / 1000 / k1;
        const activeIndex = commands.findLastIndex((command) => command.atMs <= changeMs);
        const nextStart = commands.findIndex((command, at) => at > activeIndex && command.passSpeed === 0);
        const runEnd = nextStart < 0 ? commands.length : nextStart;
        const schedule = (runDeceleration: number): DriveCommand[] => {
          const scaled = (command: AxisMoveCommand, k: number, decelerationScale: number, atSec: number) => ({
            atSec,
            target: command.target,
            velocity: command.velocity * k,
            acceleration: command.acceleration * k * k,
            deceleration: command.deceleration * decelerationScale,
            passSpeed: command.passSpeed,
          });
          const drive = commands.flatMap((command, at) => {
            if (at <= activeIndex) return [scaled(command, k1, k1 * k1, command.atMs / 1000 / k1)];
            const atSec = changeSec + (command.atMs - changeMs) / 1000 / k2;
            return [scaled(command, k2, at < runEnd ? runDeceleration : k2 * k2, atSec)];
          });
          const active = commands[activeIndex];
          if (!active) return drive;
          const reissued = { ...scaled(active, k2, runDeceleration, changeSec), passSpeed: -1 };
          drive.splice(activeIndex + 1, 0, reissued);
          if (runDeceleration === k2 * k2) return drive;
          // 这段运动剩下的指令：减速度只增不减
          let held = reissued.deceleration;
          for (let at = activeIndex + 2; at <= runEnd; at += 1) {
            const command = drive[at]!;
            held = Math.max(held, command.deceleration);
            drive[at] = { ...command, deceleration: held };
          }
          return drive;
        };
        const untilSec = changeSec + (endMs - changeMs + 60000) / 1000 / k2;
        const naive = simulateDrive(schedule(k2 * k2), 0, untilSec);
        if (naive.worstBrakeRatio > BRAKE_RATIO_LIMIT) naiveOvershoots += 1;
        const ruled = simulateDrive(schedule(Math.max(k1, k2) ** 2), 0, untilSec, true);
        expect(ruled.worstBrakeRatio).toBeLessThanOrEqual(BRAKE_RATIO_LIMIT);
        expect(ruled.endX).toBeCloseTo(blocks[blocks.length - 1]!.pose.v1!, 6);
      }
    }
    expect(naiveOvershoots).toBeGreaterThan(0);
  });
});
