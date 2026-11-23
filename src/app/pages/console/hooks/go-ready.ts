import type { VirtualAxisId, VirtualAxisValues } from "@/app/project/project-document-types";
import { DIMENSION_KEY_TO_VIRTUAL_AXIS } from "@/app/project/manual-jog";
import { ZERO_GO_VAD, type GoObjectPlan } from "./go-motion";
import type {
  ControlledObjectSnapshot,
  MonitorPositions,
} from "../components/monitor-grid/monitor-data";

export type GoPhase = "idle" | "armed" | "moving";

/**
 * GO 目标（影子）是怎么来的，GO 条上写明：pose 选中的位姿（同一时刻时带时刻），
 * cursor 没选位姿时游标处序列的样子，manual 维度控制填的，sequence「去这里」某条序列的起点
 */
export type GoTargetSource =
  | { kind: "pose"; atMs?: number }
  | { kind: "cursor"; atMs: number }
  | { kind: "manual" }
  | { kind: "sequence"; name: string };

export type GoReadyEntry = {
  objectId: string;
  target: VirtualAxisValues;
  current: VirtualAxisValues;
  dispatched?: boolean;
  /** 下发时刻（Date.now()） */
  dispatchedAt?: number;
  /** 没写时当作手动目标 */
  source?: GoTargetSource;
};

const formatSeconds = (ms: number): string => (ms / 1000).toFixed(1);

export const goTargetSourceLabel = (source: GoTargetSource | undefined): string => {
  if (!source || source.kind === "manual") return "手动目标";
  if (source.kind === "pose") return source.atMs === undefined ? "选中的位姿" : `${formatSeconds(source.atMs)} s 的位姿`;
  if (source.kind === "cursor") return `游标 ${formatSeconds(source.atMs)} s`;
  return `「${source.name}」的起点`;
};

/** GO 条上的一句话：按来源分组，「游标 12.0 s · 3 台，手动目标 · 1 台」 */
export const goTargetSummary = (entries: readonly GoReadyEntry[]): string => {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const label = goTargetSourceLabel(entry.source);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => `${label} · ${count} 台`).join("，");
};

/** 维度控制、去这里这些点名要去的目标（不是跟着位姿或游标绑上的） */
export const isExplicitGoEntry = (entry: GoReadyEntry): boolean =>
  entry.source?.kind !== "pose" && entry.source?.kind !== "cursor";

export type GoReadyState = {
  phase: GoPhase;
  mode: "abs" | "rel";
  entries: GoReadyEntry[];
};

export type MoveTargetItem = {
  deviceId: number;
  hTargetPosition: number;
  hVelocity: number;
  hAcceleration: number;
  hDeceleration: number;
  pTargetPosition: number;
  pVelocity: number;
  pAcceleration: number;
  pDeceleration: number;
  yTargetPosition: number;
  yVelocity: number;
  yAcceleration: number;
  yDeceleration: number;
  moveDirection: number;
};

const AXES = ["v1", "v2", "v3"] as const;

export type AxisRange = { min: number; max: number };

export const clampToAxisRange = (value: number, range: AxisRange | undefined): number => {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min > range.max) {
    return value;
  }
  return Math.min(range.max, Math.max(range.min, value));
};

export const ARRIVAL_TOLERANCE: Record<VirtualAxisId, number> = {
  v1: 1,
  v2: 0.5,
  v3: 0.5,
};

/** 将监控位置（h/p/y，可能部分缺轴）映射为虚轴值（v1/v2/v3），仅保留有值的轴。 */
export const positionsToAxisValues = (
  positions: MonitorPositions | null,
): VirtualAxisValues => {
  if (!positions) return {};
  return {
    ...(positions.h !== undefined ? { v1: positions.h } : {}),
    ...(positions.p !== undefined ? { v2: positions.p } : {}),
    ...(positions.y !== undefined ? { v3: positions.y } : {}),
  };
};

/** 相对位移基准：优先已设目标，否则取当前监控值。 */
/** 相对模式的基准：物体当前的实际位置（不是已设的 GO 目标）；没有监控位置时 undefined */
export const resolveRelativeBase = (
  axis: VirtualAxisId,
  current: VirtualAxisValues,
): number | undefined => current[axis];

export const resolveGoTargets = (
  snapshots: ControlledObjectSnapshot[],
  drafts: Record<string, number>,
  mode: "abs" | "rel",
  rangesByObjectId: Record<string, Partial<Record<VirtualAxisId, AxisRange>>> = {},
): GoReadyEntry[] => {
  const entries: GoReadyEntry[] = [];
  for (const snapshot of snapshots) {
    const objectId = String(snapshot.descriptor.id);
    const current = positionsToAxisValues(snapshot.positions);
    const ranges = rangesByObjectId[objectId];
    const target: VirtualAxisValues = {};
    for (const [dimKey, draftValue] of Object.entries(drafts)) {
      const axis = DIMENSION_KEY_TO_VIRTUAL_AXIS[dimKey];
      if (!axis) continue;
      if (mode === "rel") {
        const base = resolveRelativeBase(axis, current);
        if (base === undefined) continue;
        target[axis] = clampToAxisRange(base + draftValue, ranges?.[axis]);
      } else {
        target[axis] = clampToAxisRange(draftValue, ranges?.[axis]);
      }
    }
    if (Object.keys(target).length === 0) continue;
    entries.push({ objectId, target, current });
  }
  return entries;
};

export const isArrived = (
  current: VirtualAxisValues,
  target: VirtualAxisValues,
  tolerance: Record<VirtualAxisId, number>,
): boolean => {
  for (const axis of AXES) {
    const want = target[axis];
    if (want === undefined) continue;
    const have = current[axis];
    if (have === undefined) return false; // 目标轴无监控值，视为未到位
    if (Math.abs(have - want) > tolerance[axis]) return false;
  }
  return true;
};

/** 目标里没写的轴按设目标时的当前位置下发（不动），连当前位置也没有才是 0 */
/**
 * 一条目标位置运动。plan 给出各轴下发的速度、加速度、减速度（没给的轴填 0，C++ 走搭建里的默认值）
 * 和方向：无极旋转只有正转 1 / 反转 2，其它物体 0（自动）。
 */
/** 去掉浮点尾数（110.00000000000001 → 110）；按有效数字取，很小的加速度也不会变成 0（0 = 走默认） */
const cleanRate = (value: number): number => (Number.isFinite(value) ? Number(value.toPrecision(6)) : value);

export const buildMoveTargetItem = (
  entry: GoReadyEntry,
  plan?: Pick<GoObjectPlan, "direction" | "axes">,
): MoveTargetItem => {
  const vad = (axis: VirtualAxisId) => {
    const rates = plan?.axes[axis] ?? ZERO_GO_VAD;
    return {
      velocity: cleanRate(rates.velocity),
      acceleration: cleanRate(rates.acceleration),
      deceleration: cleanRate(rates.deceleration),
    };
  };
  return {
    deviceId: Number(entry.objectId),
    hTargetPosition: entry.target.v1 ?? entry.current.v1 ?? 0,
    hVelocity: vad("v1").velocity,
    hAcceleration: vad("v1").acceleration,
    hDeceleration: vad("v1").deceleration,
    pTargetPosition: entry.target.v2 ?? entry.current.v2 ?? 0,
    pVelocity: vad("v2").velocity,
    pAcceleration: vad("v2").acceleration,
    pDeceleration: vad("v2").deceleration,
    yTargetPosition: entry.target.v3 ?? entry.current.v3 ?? 0,
    yVelocity: vad("v3").velocity,
    yAcceleration: vad("v3").acceleration,
    yDeceleration: vad("v3").deceleration,
    moveDirection: plan?.direction ?? 0,
  };
};

export const pendingGoEntries = (entries: readonly GoReadyEntry[]): GoReadyEntry[] =>
  entries.filter((entry) => !entry.dispatched);

export const goEntriesForObjectIds = (
  entries: readonly GoReadyEntry[],
  objectIds: readonly string[],
): GoReadyEntry[] => {
  const idSet = new Set(objectIds);
  return entries.filter((entry) => idSet.has(entry.objectId));
};

export const markGoDispatched = (
  entries: readonly GoReadyEntry[],
  objectIds: readonly string[],
  now: number = Date.now(),
): GoReadyEntry[] => {
  const idSet = new Set(objectIds);
  return entries.map((entry) =>
    idSet.has(entry.objectId) ? { ...entry, dispatched: true, dispatchedAt: now } : entry,
  );
};

/**
 * 刚下发的 GO：遥测约 0.43 s 一帧，设备的「运动」状态要过一两帧才报上来，这段时间也当作在动。
 * 过了这段时间就只看遥测状态，没走到容差内停下的设备不会一直被当成在动。
 */
export const GO_START_GRACE_MS = 1500;

export const isGoStarting = (entry: GoReadyEntry, now: number = Date.now()): boolean =>
  entry.dispatched === true && now - (entry.dispatchedAt ?? 0) < GO_START_GRACE_MS;

/**
 * 在容差内停够这么久也算走完：遥测不报 modelStatus、或停下后状态没变回静止时的兜底。
 * 主进程只在数值变化时转发遥测，物体停下后就没有帧了，不能按「连续几帧到位」判断。
 */
export const GO_ARRIVE_SETTLE_MS = 1000;

export type GoEntryProgress =
  | { done: true }
  | {
      done: false;
      /** 从什么时候起一直在容差内（Date.now()） */
      arrivedSince?: number;
      /** 到这个时刻即使没有新遥测也要再判断一次 */
      recheckAt?: number;
    };

/**
 * 已下发的 GO 走完了没有：
 * - 过了起步宽限期、遥测报不在运动（静止 / 停止 / 报警），到没到目标都算走完；
 * - 或者在容差内停够 GO_ARRIVE_SETTLE_MS。
 * 没有遥测（离线）时不判断。
 */
export const goEntryProgress = (
  entry: GoReadyEntry,
  snapshot: ControlledObjectSnapshot | undefined,
  now: number,
  arrivedSince: number | undefined,
): GoEntryProgress => {
  if (!snapshot) return { done: false };
  const arrived = isArrived(
    positionsToAxisValues(snapshot.positions),
    entry.target,
    ARRIVAL_TOLERANCE,
  );
  const since = arrived ? (arrivedSince ?? now) : undefined;
  const settledAt = since === undefined ? undefined : since + GO_ARRIVE_SETTLE_MS;
  if (settledAt !== undefined && now >= settledAt) return { done: true };

  const stopped = snapshot.modelStatus != null && snapshot.descriptor.status !== "running";
  const graceEnd = (entry.dispatchedAt ?? 0) + GO_START_GRACE_MS;
  if (stopped && now >= graceEnd) return { done: true };

  const deadlines = [settledAt, stopped ? graceEnd : undefined].filter(
    (time): time is number => time !== undefined,
  );
  return {
    done: false,
    arrivedSince: since,
    recheckAt: deadlines.length > 0 ? Math.min(...deadlines) : undefined,
  };
};

export const removeGoEntries = (
  entries: readonly GoReadyEntry[],
  objectIds: readonly string[],
): GoReadyEntry[] => {
  const idSet = new Set(objectIds);
  return entries.filter((entry) => !idSet.has(entry.objectId));
};

export const goPhaseFromEntries = (entries: readonly GoReadyEntry[]): GoPhase => {
  if (entries.length === 0) return "idle";
  return pendingGoEntries(entries).length === 0 ? "moving" : "armed";
};

/**
 * 动作页联机：选中位姿给出的 GO 目标（按物体 id）。
 * 绑定的物体到位或被清除后，GO 目标回到这里，影子一直停在位姿上。
 */
export type GoBinding = Pick<GoReadyEntry, "target" | "current" | "source">;
export type GoBindings = ReadonlyMap<string, GoBinding>;

const boundEntry = (objectId: string, binding: GoBinding): GoReadyEntry => ({
  objectId,
  target: { ...binding.target },
  current: { ...binding.current },
  dispatched: false,
  ...(binding.source ? { source: binding.source } : {}),
});

/**
 * 换绑定：不再绑定的物体去掉还没下发的目标；新绑定的物体目标设为位姿值。
 * 正在走的（已下发）条目保留，到位后再回到绑定的目标。
 * exclusive（影子跟着游标）：别的还没下发的目标也去掉，影子只剩这一帧。
 */
export const applyGoBindings = (
  entries: readonly GoReadyEntry[],
  previous: GoBindings,
  next: GoBindings,
  exclusive = false,
): GoReadyEntry[] => {
  const result: GoReadyEntry[] = [];
  for (const entry of entries) {
    if (next.has(entry.objectId)) {
      if (entry.dispatched) result.push(entry);
      continue;
    }
    if ((previous.has(entry.objectId) || exclusive) && !entry.dispatched) continue;
    result.push(entry);
  }
  for (const [objectId, binding] of next) {
    if (result.some((entry) => entry.objectId === objectId)) continue;
    result.push(boundEntry(objectId, binding));
  }
  return result;
};

/** 到位或清除：绑定的物体回到绑定的目标，其余物体去掉 */
export const releaseGoEntries = (
  entries: readonly GoReadyEntry[],
  objectIds: readonly string[],
  bindings: GoBindings,
): GoReadyEntry[] => {
  const idSet = new Set(objectIds);
  return entries.flatMap((entry) => {
    if (!idSet.has(entry.objectId)) return [entry];
    const binding = bindings.get(entry.objectId);
    return binding ? [boundEntry(entry.objectId, binding)] : [];
  });
};
