import {
  allocateSetupEntityIds,
  isValidSetupEntityId,
} from "@/app/pages/console/hooks/setup-entity-id";

export const collectUsedSequenceIds = (sequences: readonly { id?: unknown }[]): Set<number> => {
  const used = new Set<number>();
  for (const sequence of sequences) {
    if (isValidSetupEntityId(sequence.id)) used.add(sequence.id);
  }
  return used;
};

export const allocateSequenceIds = (usedIds: Iterable<number>, count: number): number[] => {
  try {
    return allocateSetupEntityIds(usedIds, count);
  } catch (error) {
    if (error instanceof Error && error.message.includes("已满")) {
      throw new Error("动作序列 id 已满（1~65535）");
    }
    throw error;
  }
};

export const allocateSequenceIdsInProject = (
  sequences: readonly { id?: unknown }[],
  count: number,
): number[] => allocateSequenceIds(collectUsedSequenceIds(sequences), count);
