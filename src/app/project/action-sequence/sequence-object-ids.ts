import type { ActionSequenceConfig } from "./types";

/** 序列引用的全部物体 id：单物体块的 objectId + 预设块的 orderedObjectIds */
export const sequenceObjectIds = (sequence: ActionSequenceConfig): Set<number> => {
  const ids = new Set<number>();
  for (const block of sequence.blocks) {
    if (block.kind === "pose" || block.kind === "instruction") {
      ids.add(block.objectId);
      continue;
    }
    for (const objectId of block.orderedObjectIds) ids.add(objectId);
  }
  return ids;
};

/** 序列成员里是否存在尚未耦合的物体。没有成员时视为已满足。 */
export const hasUncoupledSequenceMember = (
  sequence: ActionSequenceConfig,
  coupledObjectIds: ReadonlySet<number>,
): boolean => {
  for (const objectId of sequenceObjectIds(sequence)) {
    if (!coupledObjectIds.has(objectId)) return true;
  }
  return false;
};
