import { minimumMotionProfile } from "@/app/project/action-sequence/nearest-start-motion";
import type { KeyframePose, MotionProfile } from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { LIMIT_MARGIN, type AxisRateLimits } from "../motion-profile/segment-presets";
import { TIME_STEP_MS, snapTimeMs } from "../timeline/timeline-data";

const AXES: readonly VirtualAxisId[] = ["v1", "v2", "v3"];
const EPS = 1e-6;

/** 参与追赶的一台：从哪到哪（只动终点设了值、而且和起点不一样的轴），搭建里的默认值和上限 */
export type ChaseObject = {
  objectId: number;
  name: string;
  from: KeyframePose;
  to: KeyframePose;
  limits: Partial<Record<VirtualAxisId, AxisRateLimits>>;
};

/**
 * 追赶汇合：B（leader）先出发慢走，A（chaser）后出发加速；汇合时同位置同速度，之后并排到终点。
 * 时刻都相对 startMs。
 */
export type ChaseRhythm = {
  axis: VirtualAxisId;
  leaderId: number;
  chaserId: number;
  leaderStartMs: number;
  chaserStartMs: number;
  /** 汇合时刻和汇合位置给一个；都不给时在 B 的起点和终点正中汇合 */
  mergeAtMs?: number;
  mergePosition?: number;
  /** 到达时刻；不给时取最早能到 */
  arriveAtMs?: number;
};

/** 生成的一个位姿：时刻、设定的轴、手填的经过速度（汇合点） */
export type PlannedPose = {
  atMs: number;
  pose: KeyframePose;
  passSpeeds?: Partial<Record<VirtualAxisId, number>>;
};

/** 相邻两个生成位姿之间那段的曲线（poses 里的下标） */
export type PlannedSegment = {
  fromIndex: number;
  toIndex: number;
  profiles: Partial<Record<VirtualAxisId, MotionProfile>>;
};

export type ChaseObjectPlan = {
  objectId: number;
  name: string;
  /** 开始动、到达（绝对时刻） */
  moveStartMs: number;
  arriveMs: number;
  poses: PlannedPose[];
  segments: PlannedSegment[];
};

export type ChaseInfo = {
  mergeAtMs: number;
  mergePosition: number;
  /** 并排速度（汇合后两台一起的匀速） */
  sideBySideSpeed: number;
  /** B 汇合前慢走的速度 */
  leaderSpeed: number;
};

export type ChasePlan = {
  startMs: number;
  endMs: number;
  objects: ChaseObjectPlan[];
  /** 最早能到（绝对时刻），按上限的 95% 算 */
  earliestEndMs?: number;
  chase?: ChaseInfo;
  /** 有它时不能写入 */
  error?: string;
};

const positive = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;

const ceilStep = (sec: number): number =>
  Math.max(1, Math.ceil((sec * 1000) / TIME_STEP_MS - 1e-9)) * TIME_STEP_MS;

const formatSec = (ms: number): string => (ms / 1000).toFixed(1);

type Rates = { speed: number; accel: number };

const defaultRates = (limits: AxisRateLimits | undefined): Rates | null => {
  const speed = positive(limits?.defaultSpeed);
  const accel = positive(limits?.defaultAccel);
  if (speed === undefined || accel === undefined) return null;
  const maxSpeed = positive(limits?.maxSpeed);
  const maxAccel = positive(limits?.maxAccel);
  return {
    speed: maxSpeed === undefined ? speed : Math.min(speed, maxSpeed),
    accel: maxAccel === undefined ? accel : Math.min(accel, maxAccel),
  };
};

const fastestRates = (limits: AxisRateLimits | undefined): Rates | null => {
  const maxSpeed = positive(limits?.maxSpeed);
  const maxAccel = positive(limits?.maxAccel);
  if (maxSpeed === undefined || maxAccel === undefined) return null;
  return { speed: maxSpeed * LIMIT_MARGIN, accel: maxAccel * LIMIT_MARGIN };
};

const secondsAt = (distance: number, rates: Rates): number =>
  minimumMotionProfile(distance, rates.speed, rates.accel, rates.accel).time;

type AxisMove = { axis: VirtualAxisId; distance: number; limits: AxisRateLimits | undefined };

const axisMoves = (object: ChaseObject): AxisMove[] =>
  AXES.flatMap((axis) => {
    const from = object.from[axis];
    const to = object.to[axis];
    if (from === undefined || to === undefined || Math.abs(to - from) <= EPS) return [];
    return [{ axis, distance: Math.abs(to - from), limits: object.limits[axis] }];
  });

const stopSpeeds = (axes: readonly VirtualAxisId[]): Pick<PlannedPose, "passSpeeds"> =>
  axes.length > 0 ? { passSpeeds: Object.fromEntries(axes.map((axis) => [axis, 0])) } : {};

type ChaseSolution = {
  v: number;
  aA: number;
  d: number;
  aB: number;
  tmMs: number;
  xm: number;
  vB: number;
};

/**
 * 追赶汇合的运动（单位：秒、沿运动方向的距离）：
 * A 是一段普通梯形（加速到并排速度 v、匀速、最后减速到终点）；
 * B 先慢走 vB，汇合前加速到 v，汇合时正好和 A 同位置；之后两台同一段。
 */
const solveChase = (input: {
  distA: number;
  xB0: number;
  sA: number;
  sB: number;
  T: number;
  aA: number;
  aB: number;
  d: number;
  vMax: number;
  mergeAtMs?: number;
  mergeX?: number;
}): ChaseSolution | string => {
  const { distA, xB0, aA, aB, d, vMax } = input;
  const tau = (input.T - input.sA) / 1000;
  const c = 1 / (2 * aA) + 1 / (2 * d);
  const disc = tau * tau - 4 * c * distA;
  if (!(tau > 0) || disc < 0) return "到达时刻太早，A 来不及";
  const v = (tau - Math.sqrt(disc)) / (2 * c);
  if (v > vMax * (1 + 1e-9)) return "到达时刻太早，并排速度会超过上限";
  const cruiseStart = input.sA / 1000 + v / aA;
  const cruiseEnd = input.T / 1000 - v / d;
  let tm: number;
  if (input.mergeAtMs !== undefined) tm = input.mergeAtMs / 1000;
  else {
    // 没指定时在 B 的起点和终点正中汇合（一定在 B 前面），落到 A 的匀速段里
    const mergeX = input.mergeX ?? (xB0 + distA) / 2;
    const at = cruiseStart + (mergeX - (v * v) / (2 * aA)) / v;
    tm = input.mergeX === undefined ? Math.min(Math.max(at, cruiseStart), cruiseEnd) : at;
  }
  tm = snapTimeMs(tm * 1000) / 1000;
  if (tm < cruiseStart - 1e-9 || tm > cruiseEnd + 1e-9) {
    return `汇合要在 A 匀速的那段里（${cruiseStart.toFixed(1)}–${cruiseEnd.toFixed(1)} s）`;
  }
  const xm = (v * v) / (2 * aA) + v * (tm - cruiseStart);
  const tauB = tm - input.sB / 1000;
  if (tauB <= v / aB) return "B 来不及加速到并排速度：汇合太早，或 B 出发太晚";
  const vB = (xm - xB0 - (v * v) / (2 * aB)) / (tauB - v / aB);
  if (!(vB > 0)) return "B 离汇合位置太近：汇合太早，或 B 起点太靠前";
  if (vB >= v) return "B 不比 A 慢，A 追不上：汇合太晚，或 B 出发太晚";
  return { v, aA, d, aB, tmMs: Math.round(tm * 1000), xm, vB };
};

/**
 * 变速时间往上取到 0.1 s：取近了会比算好的更猛，慢走很慢时可能超过上限。
 * 汇合的位置、时刻和速度由位姿和经过速度定死，变速稍长只让匀速稍快一点。
 */
const rampMs = (sec: number): number => ceilStep(sec);

/** 追赶汇合：两台的位姿和曲线；startMs 是写进序列的时刻 */
export const planChase = (
  startMs: number,
  objects: readonly ChaseObject[],
  rhythm: ChaseRhythm,
): ChasePlan => {
  const fail = (error: string): ChasePlan => ({ startMs, endMs: startMs, objects: [], error });
  const chaser = objects.find((object) => object.objectId === rhythm.chaserId);
  const leader = objects.find((object) => object.objectId === rhythm.leaderId);
  if (!chaser || !leader || chaser === leader) return fail("选出追赶的 A 和领先的 B（两台不同的物体）");
  const { axis } = rhythm;
  for (const object of [chaser, leader]) {
    const others = axisMoves(object).filter((move) => move.axis !== axis);
    if (others.length > 0) return fail(`追赶汇合只动 ${axis.toUpperCase()}：${object.name} 的其它轴起点终点要一样`);
  }
  const pA0 = chaser.from[axis];
  const pB0 = leader.from[axis];
  const pEnd = chaser.to[axis];
  if (pA0 === undefined || pB0 === undefined || pEnd === undefined || leader.to[axis] === undefined) {
    return fail("两台都要有这个轴的起点和终点");
  }
  if (Math.abs(leader.to[axis]! - pEnd) > EPS) return fail("两台的终点不一样，汇合后没法并排");
  const dir = Math.sign(pEnd - pA0);
  if (dir === 0) return fail(`${chaser.name} 不用动`);
  const distA = (pEnd - pA0) * dir;
  const xB0 = (pB0 - pA0) * dir;
  if (xB0 < -EPS) return fail(`${leader.name} 要在 ${chaser.name} 前面（沿运动方向）`);
  if ((pEnd - pB0) * dir <= EPS) return fail(`${leader.name} 不用动或方向不对`);

  const limitsA = chaser.limits[axis];
  const limitsB = leader.limits[axis];
  const normalA = defaultRates(limitsA);
  const normalB = defaultRates(limitsB);
  const fastA = fastestRates(limitsA);
  const fastB = fastestRates(limitsB);
  if (!normalA || !normalB || !fastA || !fastB) return fail("两台都要设默认速度、加速度和上限");
  const vMax = Math.min(fastA.speed, fastB.speed);
  const capA = fastA.accel;
  const capD = Math.min(fastA.accel, fastB.accel);
  const sA = startMs + snapTimeMs(rhythm.chaserStartMs);
  const sB = startMs + snapTimeMs(rhythm.leaderStartMs);
  const mergeAtMs = rhythm.mergeAtMs === undefined ? undefined : startMs + snapTimeMs(rhythm.mergeAtMs);
  const mergeX = rhythm.mergePosition === undefined ? undefined : (rhythm.mergePosition - pA0) * dir;

  /** 加速度先用默认的，不够时往上提，最多到上限的 95% */
  const solveAt = (T: number): ChaseSolution | string => {
    let last: ChaseSolution | string = "到达时刻太早";
    for (const factor of [1, 1.5, 2, 3, 5]) {
      const aA = Math.min(normalA.accel * factor, capA);
      const d = Math.min(Math.min(normalA.accel, normalB.accel) * factor, capD);
      const aB = Math.min(normalB.accel * factor, fastB.accel);
      last = solveChase({ distA, xB0, sA, sB, T, aA, aB, d, vMax, mergeAtMs, mergeX });
      if (typeof last !== "string") return last;
      if (aA >= capA && d >= capD && aB >= fastB.accel) break;
    }
    return last;
  };

  // 最早能到：从 A 最快能到的时刻起，每 0.1 s 往后试
  const lowest = sA + ceilStep(secondsAt(distA, fastA));
  let earliestEndMs: number | undefined;
  for (let T = lowest; T <= lowest + 600 * TIME_STEP_MS; T += TIME_STEP_MS) {
    if (typeof solveAt(T) !== "string") {
      earliestEndMs = T;
      break;
    }
  }
  const T = rhythm.arriveAtMs === undefined ? earliestEndMs : startMs + snapTimeMs(rhythm.arriveAtMs);
  if (T === undefined) return fail("找不到能汇合的到达时刻：调一调出发时刻或汇合时刻");
  const solution = solveAt(T);
  if (typeof solution === "string") {
    return {
      ...fail(solution),
      earliestEndMs,
      error:
        earliestEndMs !== undefined && T < earliestEndMs
          ? `${solution}；最早 ${formatSec(earliestEndMs - startMs)} s 能到`
          : solution,
    };
  }

  const { v, aA, d, aB, tmMs, xm, vB } = solution;
  const pm = pA0 + dir * xm;
  const passSpeeds = { [axis]: Math.round(v * 10) / 10 };
  const afterMerge: MotionProfile = {
    kind: "trapezoid",
    params: { accelMs: TIME_STEP_MS, decelMs: rampMs(v / d) },
  };
  const build = (
    object: ChaseObject,
    moveStartMs: number,
    beforeMerge: MotionProfile,
  ): ChaseObjectPlan => {
    const poses: PlannedPose[] = [];
    if (moveStartMs > startMs) poses.push({ atMs: startMs, pose: { ...object.from } });
    poses.push({ atMs: moveStartMs, pose: { ...object.from }, ...stopSpeeds([axis]) });
    poses.push({ atMs: tmMs, pose: { [axis]: Math.round(pm * 10) / 10 }, passSpeeds });
    poses.push({ atMs: T, pose: { ...object.to }, ...stopSpeeds([axis]) });
    const last = poses.length - 1;
    return {
      objectId: object.objectId,
      name: object.name,
      moveStartMs,
      arriveMs: T,
      poses,
      segments: [
        { fromIndex: last - 2, toIndex: last - 1, profiles: { [axis]: beforeMerge } },
        { fromIndex: last - 1, toIndex: last, profiles: { [axis]: afterMerge } },
      ],
    };
  };
  return {
    startMs,
    endMs: T,
    earliestEndMs,
    chase: { mergeAtMs: tmMs, mergePosition: pm, sideBySideSpeed: v, leaderSpeed: vB },
    objects: [
      build(chaser, sA, { kind: "trapezoid", params: { accelMs: rampMs(v / aA), decelMs: TIME_STEP_MS } }),
      build(leader, sB, {
        kind: "trapezoid",
        params: { accelMs: rampMs(vB / aB), decelMs: rampMs((v - vB) / aB) },
      }),
    ],
  };
};
