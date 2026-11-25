import { rotationGeometryOf } from "@/app/project/action-sequence/algorithm-models";
import { minimumMotionProfile } from "@/app/project/action-sequence/nearest-start-motion";
import { setupObjectToTimelineObject } from "@/app/project/motion-adapters";
import type {
  ControlledObjectConfig,
  MotorConfig,
  VirtualAxisId,
  VirtualAxisValues,
} from "@/app/project/project-document-types";

/** 「最快」不超过上限的这个比例（和动作页参考时长一样） */
export const GO_LIMIT_MARGIN = 0.95;

const AXES: readonly VirtualAxisId[] = ["v1", "v2", "v3"];

/** 一个轴搭建里设的默认速度、加速度和上限（单位/秒、单位/秒²） */
export type GoAxisLimits = {
  defaultSpeed?: number;
  defaultAccel?: number;
  maxSpeed?: number;
  maxAccel?: number;
};

/** 算 GO 要知道的物体信息；rotation 只有无极旋转物体有（H 的周期） */
export type GoObjectInfo = {
  axes: Partial<Record<VirtualAxisId, GoAxisLimits>>;
  rotation?: { period: number } | null;
};

/** 下发方向：0 自动（线性轴），1 正转，2 反转（无极旋转没有自动） */
export type GoDirection = 0 | 1 | 2;

/** 一个轴下发的速度、加速度、减速度；全 0 = 走搭建里的默认值 */
export type GoAxisVad = { velocity: number; acceleration: number; deceleration: number };

export const ZERO_GO_VAD: GoAxisVad = { velocity: 0, acceleration: 0, deceleration: 0 };

/** GO 的走法：各自默认速度 / 同时到达 / 指定时长 */
export type GoTiming =
  | { kind: "default" }
  | { kind: "sync" }
  | { kind: "duration"; durationMs: number };

const positive = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;

const mod = (value: number, period: number): number => ((value % period) + period) % period;

/** 无极旋转往哪边转：转得少的那边；正好半圈、或不用转时正转 */
export const shorterRotation = (current: number, target: number, period: number): 1 | 2 => {
  const delta = mod(target - current, period);
  return delta <= period / 2 + 1e-9 ? 1 : 2;
};

/** 一个轴要走的距离：线性轴取差的绝对值；无极旋转的 H 按方向取模，不到一圈 */
export const goAxisTravel = (
  axis: VirtualAxisId,
  current: number,
  target: number,
  rotation: { period: number } | null | undefined,
  direction: GoDirection,
): number => {
  if (axis !== "v1" || !rotation) return Math.abs(target - current);
  const delta = mod(target - current, rotation.period);
  if (delta < 1e-9 || rotation.period - delta < 1e-9) return 0;
  return direction === 2 ? rotation.period - delta : delta;
};

/** 默认速度：速度、加减速度取搭建里的默认值，不超过上限 */
const defaultVad = (limits: GoAxisLimits): GoAxisVad | null => {
  const speed = positive(limits.defaultSpeed);
  const accel = positive(limits.defaultAccel);
  if (speed === undefined || accel === undefined) return null;
  const maxSpeed = positive(limits.maxSpeed);
  const maxAccel = positive(limits.maxAccel);
  const velocity = maxSpeed === undefined ? speed : Math.min(speed, maxSpeed);
  const acceleration = maxAccel === undefined ? accel : Math.min(accel, maxAccel);
  return { velocity, acceleration, deceleration: acceleration };
};

/** 最快：速度、加减速度都取上限的 95% */
const fastestVad = (limits: GoAxisLimits): GoAxisVad | null => {
  const maxSpeed = positive(limits.maxSpeed);
  const maxAccel = positive(limits.maxAccel);
  if (maxSpeed === undefined || maxAccel === undefined) return null;
  return {
    velocity: maxSpeed * GO_LIMIT_MARGIN,
    acceleration: maxAccel * GO_LIMIT_MARGIN,
    deceleration: maxAccel * GO_LIMIT_MARGIN,
  };
};

/** 按这组 V/A/D 从静止走到静止要几秒 */
const secondsAt = (travel: number, vad: GoAxisVad): number =>
  minimumMotionProfile(travel, vad.velocity, vad.acceleration, vad.deceleration).time;

/** 整条曲线等比例拉长：时间变成 1/k 倍，速度乘 k，加减速度乘 k² */
const scaled = (vad: GoAxisVad, k: number): GoAxisVad => ({
  velocity: vad.velocity * k,
  acceleration: vad.acceleration * k * k,
  deceleration: vad.deceleration * k * k,
});

/** 一个物体这次 GO：方向、各轴下发的 V/A/D、按这个走法要几秒（算不出时 null） */
export type GoObjectPlan = {
  objectId: string;
  direction: GoDirection;
  axes: Partial<Record<VirtualAxisId, GoAxisVad>>;
  /** 按默认速度要几秒；没有要动的轴为 0，没配默认速度为 null */
  defaultSeconds: number | null;
  /** 按上限 95% 最快几秒 */
  fastestSeconds: number | null;
  /** 按这次的走法要几秒 */
  seconds: number | null;
};

export type GoPlan = {
  objects: GoObjectPlan[];
  /** 全部到位要几秒；有物体算不出时 null */
  totalSeconds: number | null;
  /** 最慢的那台 */
  slowestId?: string;
  /** 同时到达 / 指定时长做不到的原因；有它时不能 GO */
  error?: string;
  /** 指定时长时最短能多快（秒） */
  shortestSeconds?: number;
};

export type GoPlanEntry = { objectId: string; target: VirtualAxisValues; current: VirtualAxisValues };

type AxisWork = { axis: VirtualAxisId; travel: number; limits: GoAxisLimits };

const axisWorkOf = (
  entry: GoPlanEntry,
  info: GoObjectInfo | null,
  direction: GoDirection,
): AxisWork[] =>
  AXES.flatMap((axis) => {
    const target = entry.target[axis];
    const current = entry.current[axis];
    if (target === undefined || current === undefined) return [];
    const travel = goAxisTravel(axis, current, target, info?.rotation, direction);
    return travel > 1e-9 ? [{ axis, travel, limits: info?.axes[axis] ?? {} }] : [];
  });

const maxOf = (values: ReadonlyArray<number | null>): number | null =>
  values.some((value) => value === null) ? null : Math.max(0, ...(values as number[]));

/**
 * 这次 GO 怎么走：无极旋转选方向（directions 里指定的优先，否则转得少的那边），
 * 各轴按走法算 V/A/D 和用时。
 * - 各自默认速度：V/A/D 下发 0（C++ 走搭建里的默认值），用时按默认值算；
 * - 同时到达：用时 = 最慢那台的默认用时，各轴把默认曲线等比例拉长到这个时间；
 * - 指定时长：比默认慢就拉长默认曲线，比默认快就拉长上限 95% 的曲线，比最快还短做不到。
 */
export const planGo = (
  entries: readonly GoPlanEntry[],
  infoOf: (objectId: string) => GoObjectInfo | null,
  timing: GoTiming,
  directions: Readonly<Record<string, 1 | 2>> = {},
): GoPlan => {
  const prepared = entries.map((entry) => {
    const info = infoOf(entry.objectId);
    const target = entry.target.v1;
    const current = entry.current.v1;
    const direction: GoDirection = info?.rotation
      ? (directions[entry.objectId] ??
        (target !== undefined && current !== undefined
          ? shorterRotation(current, target, info.rotation.period)
          : 1))
      : 0;
    const work = axisWorkOf(entry, info, direction);
    const timeOf = (pick: (limits: GoAxisLimits) => GoAxisVad | null) =>
      maxOf(
        work.map((item) => {
          const vad = pick(item.limits);
          return vad ? secondsAt(item.travel, vad) : null;
        }),
      );
    return {
      entry,
      direction,
      work,
      defaultSeconds: timeOf(defaultVad),
      fastestSeconds: timeOf(fastestVad),
    };
  });

  const slowest = (key: "defaultSeconds" | "fastestSeconds") => {
    let best: (typeof prepared)[number] | undefined;
    for (const item of prepared) {
      if (item[key] !== null && (best === undefined || item[key]! > best[key]!)) best = item;
    }
    return best;
  };

  if (timing.kind === "default") {
    const objects = prepared.map((item) => ({
      objectId: item.entry.objectId,
      direction: item.direction,
      axes: {},
      defaultSeconds: item.defaultSeconds,
      fastestSeconds: item.fastestSeconds,
      seconds: item.defaultSeconds,
    }));
    return {
      objects,
      totalSeconds: maxOf(prepared.map((item) => item.defaultSeconds)),
      slowestId: slowest("defaultSeconds")?.entry.objectId,
    };
  }

  const missing = prepared.find((item) => item.defaultSeconds === null || item.fastestSeconds === null);
  const fastestTotal = maxOf(prepared.map((item) => item.fastestSeconds));
  const defaultTotal = maxOf(prepared.map((item) => item.defaultSeconds)) ?? 0;
  const totalSeconds = timing.kind === "sync" ? defaultTotal : timing.durationMs / 1000;
  const base = {
    totalSeconds,
    slowestId: slowest("defaultSeconds")?.entry.objectId,
    shortestSeconds: fastestTotal ?? undefined,
  };
  const noMotion = (item: (typeof prepared)[number]) => ({
    objectId: item.entry.objectId,
    direction: item.direction,
    axes: {},
    defaultSeconds: item.defaultSeconds,
    fastestSeconds: item.fastestSeconds,
    seconds: item.defaultSeconds,
  });
  if (missing) {
    return {
      ...base,
      objects: prepared.map(noMotion),
      error: "有物体没设默认速度或上限，只能按各自默认速度走",
    };
  }
  if (fastestTotal !== null && totalSeconds < fastestTotal - 1e-9) {
    return {
      ...base,
      objects: prepared.map(noMotion),
      error: `太短了，最短 ${(Math.ceil(fastestTotal * 10) / 10).toFixed(1)} s`,
    };
  }

  const objects = prepared.map((item) => {
    const axes: Partial<Record<VirtualAxisId, GoAxisVad>> = {};
    for (const { axis, travel, limits } of item.work) {
      const normal = defaultVad(limits)!;
      const normalSeconds = secondsAt(travel, normal);
      if (totalSeconds >= normalSeconds - 1e-9) {
        axes[axis] = scaled(normal, normalSeconds / totalSeconds);
        continue;
      }
      const fast = fastestVad(limits)!;
      axes[axis] = scaled(fast, Math.min(1, secondsAt(travel, fast) / totalSeconds));
    }
    return {
      objectId: item.entry.objectId,
      direction: item.direction,
      axes,
      defaultSeconds: item.defaultSeconds,
      fastestSeconds: item.fastestSeconds,
      seconds: item.work.length > 0 ? totalSeconds : 0,
    };
  });
  return { ...base, objects };
};

/** 从工程配置得到 GO 要的物体信息：默认速度、加速度、上限（同时间轴物体），无极旋转的周期 */
export const goObjectInfoFromSetup = (
  object: ControlledObjectConfig,
  motors: readonly MotorConfig[],
): GoObjectInfo => {
  const timeline = setupObjectToTimelineObject(object, motors);
  const axes: Partial<Record<VirtualAxisId, GoAxisLimits>> = {};
  for (const axis of timeline.enabledAxes ?? []) {
    const maxSpeed = timeline.maxSpeedByAxis?.[axis];
    const minAccelTime = timeline.minAccelTimeByAxis?.[axis];
    axes[axis] = {
      defaultSpeed: timeline.defaultSpeedByAxis?.[axis],
      defaultAccel: timeline.defaultAccelByAxis?.[axis],
      maxSpeed,
      maxAccel:
        maxSpeed !== undefined && minAccelTime !== undefined && minAccelTime > 0
          ? maxSpeed / minAccelTime
          : undefined,
    };
  }
  let rotation: { period: number } | null = null;
  try {
    const geometry = rotationGeometryOf(object, motors);
    rotation = geometry ? { period: geometry.period } : null;
  } catch {
    // 绑定电机工作行程不一致：按一圈 360° 选方向，配置问题在搭建里另有提示
    rotation = { period: 360 };
  }
  return { axes, rotation };
};
