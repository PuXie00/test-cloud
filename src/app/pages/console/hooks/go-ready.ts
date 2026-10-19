import type { VirtualAxisId, VirtualAxisValues } from "@/app/project/project-document-types";
import { DIMENSION_KEY_TO_VIRTUAL_AXIS } from "@/app/project/manual-jog";
import type {
  ControlledObjectSnapshot,
  MonitorPositions,
} from "../components/monitor-grid/monitor-data";

export type GoPhase = "idle" | "armed" | "moving";

export type GoReadyEntry = {
  objectId: string;
  target: VirtualAxisValues;
  current: VirtualAxisValues;
  dispatched?: boolean;
  /** 下发时刻（Date.now()） */
  dispatchedAt?: number;
};

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
export const resolveRelativeBase = (
  axis: VirtualAxisId,
  armedTarget: VirtualAxisValues,
  current: VirtualAxisValues,
): number | undefined => {
  if (armedTarget[axis] !== undefined) return armedTarget[axis];
  return current[axis];
};

export const resolveGoTargets = (
  snapshots: ControlledObjectSnapshot[],
  drafts: Record<string, number>,
  mode: "abs" | "rel",
  armedTargetsByObjectId: Record<string, VirtualAxisValues> = {},
  rangesByObjectId: Record<string, Partial<Record<VirtualAxisId, AxisRange>>> = {},
): GoReadyEntry[] => {
  const entries: GoReadyEntry[] = [];
  for (const snapshot of snapshots) {
    const objectId = String(snapshot.descriptor.id);
    const current = positionsToAxisValues(snapshot.positions);
    const armedTarget = armedTargetsByObjectId[objectId] ?? {};
    const ranges = rangesByObjectId[objectId];
    const target: VirtualAxisValues = {};
    for (const [dimKey, draftValue] of Object.entries(drafts)) {
      const axis = DIMENSION_KEY_TO_VIRTUAL_AXIS[dimKey];
      if (!axis) continue;
      if (mode === "rel") {
        const base = resolveRelativeBase(axis, armedTarget, current);
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
export const buildMoveTargetItem = (entry: GoReadyEntry): MoveTargetItem => ({
  deviceId: Number(entry.objectId),
  hTargetPosition: entry.target.v1 ?? entry.current.v1 ?? 0,
  hVelocity: 0,
  hAcceleration: 0,
  hDeceleration: 0,
  pTargetPosition: entry.target.v2 ?? entry.current.v2 ?? 0,
  pVelocity: 0,
  pAcceleration: 0,
  pDeceleration: 0,
  yTargetPosition: entry.target.v3 ?? entry.current.v3 ?? 0,
  yVelocity: 0,
  yAcceleration: 0,
  yDeceleration: 0,
  moveDirection: 0,
});

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
export type GoBinding = Pick<GoReadyEntry, "target" | "current">;
export type GoBindings = ReadonlyMap<string, GoBinding>;

const boundEntry = (objectId: string, binding: GoBinding): GoReadyEntry => ({
  objectId,
  target: { ...binding.target },
  current: { ...binding.current },
  dispatched: false,
});

/**
 * 换绑定：不再绑定的物体去掉还没下发的目标；新绑定的物体目标设为位姿值。
 * 正在走的（已下发）条目保留，到位后再回到绑定的目标。
 */
export const applyGoBindings = (
  entries: readonly GoReadyEntry[],
  previous: GoBindings,
  next: GoBindings,
): GoReadyEntry[] => {
  const result: GoReadyEntry[] = [];
  for (const entry of entries) {
    if (next.has(entry.objectId)) {
      if (entry.dispatched) result.push(entry);
      continue;
    }
    if (previous.has(entry.objectId) && !entry.dispatched) continue;
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
