/** Order-independent id list equality (used for selection sync guards). */
export const sameIdList = <T extends string | number>(
  a: readonly T[],
  b: readonly T[],
): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(b);
  return a.every((id) => set.has(id));
};

export const resolveMonitorObjectIds = (
  selectedId: number | null,
  multiSelectedIds: number[],
): number[] => (multiSelectedIds.length > 0 ? multiSelectedIds : selectedId ? [selectedId] : []);

type IdResolver = (id: string) => string | null;

/** 引擎选区 id → 项目/监控受控物体 id（遥测未绑定时与引擎 id 相同） */
export const toProjectObjectIds = (engineIds: string[], resolveSnapshotId: IdResolver): number[] =>
  engineIds.map((id) => Number(resolveSnapshotId(id) ?? id));

/** 项目/监控受控物体 id → 引擎场景 object id */
export const toEngineObjectIds = (projectIds: number[], resolveObjectId: (id: number) => string | null): string[] =>
  projectIds.map((id) => resolveObjectId(id) ?? String(id));
