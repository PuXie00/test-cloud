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
): GoReadyEntry[] => {
  const entries: GoReadyEntry[] = [];
  for (const snapshot of snapshots) {
    const objectId = String(snapshot.descriptor.id);
    const current = positionsToAxisValues(snapshot.positions);
    const armedTarget = armedTargetsByObjectId[objectId] ?? {};
    const target: VirtualAxisValues = {};
    for (const [dimKey, draftValue] of Object.entries(drafts)) {
      const axis = DIMENSION_KEY_TO_VIRTUAL_AXIS[dimKey];
      if (!axis) continue;
      if (mode === "rel") {
        const base = resolveRelativeBase(axis, armedTarget, current);
        if (base === undefined) continue;
        target[axis] = base + draftValue;
      } else {
        target[axis] = draftValue;
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

export const buildMoveTargetItem = (entry: GoReadyEntry): MoveTargetItem => ({
  deviceId: Number(entry.objectId),
  hTargetPosition: entry.target.v1 ?? 0,
  hVelocity: 0,
  hAcceleration: 0,
  hDeceleration: 0,
  pTargetPosition: entry.target.v2 ?? 0,
  pVelocity: 0,
  pAcceleration: 0,
  pDeceleration: 0,
  yTargetPosition: entry.target.v3 ?? 0,
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
): GoReadyEntry[] => {
  const idSet = new Set(objectIds);
  return entries.map((entry) =>
    idSet.has(entry.objectId) ? { ...entry, dispatched: true } : entry,
  );
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
