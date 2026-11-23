import { resolveActionSequence } from "./resolve-sequence";
import type {
  ActionSequenceConfig,
  SequenceRefBlock,
  SequenceRefContent,
  TimelineBlock,
} from "./types";

/** 引用块里存的内容：这条序列的名字、块和区间设置（深拷贝，不含 id、标记） */
export const sequenceRefContentOf = (sequence: ActionSequenceConfig): SequenceRefContent =>
  structuredClone({
    name: sequence.name,
    trajectoryMode: sequence.trajectoryMode,
    blocks: sequence.blocks,
    segments: sequence.segments,
  });

/** 拿内容当一条序列解析（时长、物体、首尾的样子） */
export const refContentAsSequence = (content: SequenceRefContent, id = 0): ActionSequenceConfig => ({
  id,
  name: content.name,
  trajectoryMode: content.trajectoryMode,
  blocks: content.blocks,
  segments: content.segments,
});

/** 内容的总时长和动到的物体 */
export const refContentExtent = (content: SequenceRefContent): { durationMs: number; objectIds: number[] } => {
  const resolved = resolveActionSequence(refContentAsSequence(content));
  const objectIds = new Set<number>(resolved.posesByObject.keys());
  for (const command of resolved.commands) objectIds.add(command.objectId);
  return { durationMs: resolved.totalMs, objectIds: [...objectIds].sort((left, right) => left - right) };
};

/** 引用 source：从 atMs 起按它现在的内容走 */
export const buildSequenceRefBlock = (
  source: ActionSequenceConfig,
  input: { id: string; atMs: number },
): SequenceRefBlock => {
  const content = sequenceRefContentOf(source);
  const { durationMs, objectIds } = refContentExtent(content);
  return {
    id: input.id,
    kind: "sequence-ref",
    sequenceId: source.id,
    atMs: input.atMs,
    durationMs,
    orderedObjectIds: objectIds,
    content,
  };
};

/** 这些块（连同引用里的内容和源序列现在的版本）有没有用到 targetId */
const blocksUseSequence = (
  blocks: readonly TimelineBlock[],
  targetId: number,
  library: ReadonlyMap<number, ActionSequenceConfig>,
  seen: Set<number>,
): boolean =>
  blocks.some((block) => {
    if (block.kind !== "sequence-ref") return false;
    if (block.sequenceId === targetId) return true;
    if (seen.has(block.sequenceId)) return false;
    seen.add(block.sequenceId);
    const current = library.get(block.sequenceId);
    return (
      blocksUseSequence(block.content.blocks, targetId, library, seen) ||
      (current !== undefined && blocksUseSequence(current.blocks, targetId, library, seen))
    );
  });

/** 在 parentId 里引用 source 会不会绕回自己：source 就是它，或 source 里（一层层）用到了它 */
export const wouldCreateRefCycle = (
  parentId: number,
  source: ActionSequenceConfig,
  library: ReadonlyMap<number, ActionSequenceConfig>,
): boolean => source.id === parentId || blocksUseSequence(source.blocks, parentId, library, new Set());

/** 这条序列直接引用了哪些序列 */
export const referencedSequenceIds = (sequence: Pick<ActionSequenceConfig, "blocks">): number[] => [
  ...new Set(
    sequence.blocks.flatMap((block) => (block.kind === "sequence-ref" ? [block.sequenceId] : [])),
  ),
];

/** 哪些序列（直接）引用了 sequenceId */
export const sequencesReferencing = (
  sequences: readonly ActionSequenceConfig[],
  sequenceId: number,
): ActionSequenceConfig[] =>
  sequences.filter((sequence) => referencedSequenceIds(sequence).includes(sequenceId));

/**
 * 引用跟着源序列走：每个引用块的内容换成 library 里那条序列现在的内容（它里面的引用先换好），
 * 时长、物体跟着算。源序列不在了、或绕回自己的保持原样。没变的序列原样返回（同一个对象）。
 */
export const refreshSequenceRefs = (
  sequences: readonly ActionSequenceConfig[],
  library: ReadonlyMap<number, ActionSequenceConfig>,
): ActionSequenceConfig[] => {
  const contents = new Map<number, SequenceRefContent | null>();
  const contentOf = (id: number, stack: readonly number[]): SequenceRefContent | null => {
    if (contents.has(id)) return contents.get(id)!;
    const source = library.get(id);
    if (!source || stack.includes(id)) return null;
    const refreshed = refreshBlocks(source.blocks, [...stack, id]);
    const content = sequenceRefContentOf(refreshed === source.blocks ? source : { ...source, blocks: refreshed });
    contents.set(id, content);
    return content;
  };
  const refreshBlocks = (blocks: TimelineBlock[], stack: readonly number[]): TimelineBlock[] => {
    let changed = false;
    const next = blocks.map((block) => {
      if (block.kind !== "sequence-ref") return block;
      const content = contentOf(block.sequenceId, stack);
      if (!content || JSON.stringify(content) === JSON.stringify(block.content)) return block;
      let extent: { durationMs: number; objectIds: number[] };
      try {
        extent = refContentExtent(content);
      } catch {
        return block;
      }
      changed = true;
      return { ...block, content, durationMs: extent.durationMs, orderedObjectIds: extent.objectIds };
    });
    return changed ? next : blocks;
  };
  return sequences.map((sequence) => {
    const blocks = refreshBlocks(sequence.blocks, [sequence.id]);
    return blocks === sequence.blocks ? sequence : { ...sequence, blocks };
  });
};
