/** 工程内 PLC / 电机 / 受控物体共享 id：1~65535 */

export const SETUP_ENTITY_ID_MIN = 1;
export const SETUP_ENTITY_ID_MAX = 65535;

export const isValidSetupEntityId = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= SETUP_ENTITY_ID_MIN &&
  value <= SETUP_ENTITY_ID_MAX;

export type SetupEntityIdSource = {
  plcs?: readonly { id?: unknown }[];
  motors?: readonly { id?: unknown }[];
  controlledObjects?: readonly { id?: unknown }[];
};

/** Wizard setup uses `objects`; the allocator reads `controlledObjects`. */
export const toSetupEntityIdSource = (setup: {
  objects?: readonly { id?: unknown }[];
  plcs?: readonly { id?: unknown }[];
  motors?: readonly { id?: unknown }[];
}): SetupEntityIdSource => ({
  plcs: setup.plcs,
  motors: setup.motors,
  controlledObjects: setup.objects,
});

/** 收集工程内已占用的 setup 实体 id */
export const collectUsedSetupEntityIds = (source: SetupEntityIdSource): Set<number> => {
  const used = new Set<number>();
  for (const plc of source.plcs ?? []) {
    if (isValidSetupEntityId(plc.id)) used.add(plc.id);
  }
  for (const motor of source.motors ?? []) {
    if (isValidSetupEntityId(motor.id)) used.add(motor.id);
  }
  for (const object of source.controlledObjects ?? []) {
    if (isValidSetupEntityId(object.id)) used.add(object.id);
  }
  return used;
};

/** 在已占用集合上分配 count 个 id（优先 max+1，否则从 1 起找空位） */
export const allocateSetupEntityIds = (
  usedIds: Iterable<number>,
  count: number,
): number[] => {
  const used = new Set<number>();
  for (const id of usedIds) {
    if (isValidSetupEntityId(id)) used.add(id);
  }

  const need = Math.max(0, Math.floor(count));
  if (need === 0) return [];

  const allocated: number[] = [];
  let highWater = used.size === 0 ? SETUP_ENTITY_ID_MIN - 1 : Math.max(...used);

  for (let i = 0; i < need; i++) {
    let id: number | null = null;

    if (highWater < SETUP_ENTITY_ID_MAX) {
      const candidate = highWater + 1;
      if (!used.has(candidate)) id = candidate;
    }

    if (id === null) {
      for (let candidate = SETUP_ENTITY_ID_MIN; candidate <= SETUP_ENTITY_ID_MAX; candidate++) {
        if (!used.has(candidate)) {
          id = candidate;
          break;
        }
      }
    }

    if (id === null) {
      throw new Error("工程内实体 id 已满（1~65535）");
    }

    used.add(id);
    allocated.push(id);
    highWater = Math.max(highWater, id);
  }

  return allocated;
};

/** 在工程 setup 上分配 count 个实体 id */
export const allocateSetupEntityIdsInProject = (
  source: SetupEntityIdSource,
  count: number,
): number[] => allocateSetupEntityIds(collectUsedSetupEntityIds(source), count);
