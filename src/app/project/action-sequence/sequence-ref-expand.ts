import type { VirtualAxisId } from "../project-document-types";
import { isAxisSet } from "./keyframe-pose";
import type {
  ActionSequenceConfig,
  MotionSegmentConfig,
  PoseBlock,
  TimelineBlock,
} from "./types";

/** 展开后里面块的 id：引用块 id + 分隔符 + 原来的 id（嵌套的一层层接上） */
export const SEQUENCE_REF_SEPARATOR = "~";

/** 嵌套引用最多展开这么多层（引用时已防住绕回自己，这里只防坏数据） */
export const SEQUENCE_REF_MAX_DEPTH = 8;

const PRESET_REF_PREFIX = "preset:";
const AXES: readonly VirtualAxisId[] = ["v1", "v2", "v3"];

export const refInnerId = (refBlockId: string, innerId: string): string =>
  `${refBlockId}${SEQUENCE_REF_SEPARATOR}${innerId}`;

/** 区间端点加上引用块的前缀：位姿端点是块 id，预设关键点是 preset:<块 id>:<物体>:<序号> */
export const refSegmentRef = (refBlockId: string, ref: string): string =>
  ref.startsWith(PRESET_REF_PREFIX)
    ? `${PRESET_REF_PREFIX}${refInnerId(refBlockId, ref.slice(PRESET_REF_PREFIX.length))}`
    : refInnerId(refBlockId, ref);

const blockStartMs = (block: TimelineBlock): number =>
  block.kind === "dynamic-preset" ? block.startMs : block.atMs;

const blockEndMs = (block: TimelineBlock): number =>
  block.kind === "dynamic-preset"
    ? block.endMs
    : block.kind === "sequence-ref"
      ? block.atMs + block.durationMs
      : block.atMs;

const blockObjectIds = (block: TimelineBlock): number[] =>
  block.kind === "pose" || block.kind === "instruction" ? [block.objectId] : block.orderedObjectIds;

const shiftBlock = (block: TimelineBlock, offsetMs: number): TimelineBlock =>
  block.kind === "dynamic-preset"
    ? { ...block, startMs: block.startMs + offsetMs, endMs: block.endMs + offsetMs }
    : { ...block, atMs: block.atMs + offsetMs };

/**
 * 每个物体最早、最晚的动作块是位姿时，引用里在这两帧停住：
 * 单独播放这条序列时首尾都是静止的，接在别的动作后面也一样，不和前后连成一条曲线。
 */
const edgePoseIds = (blocks: readonly TimelineBlock[]): Set<string> => {
  const first = new Map<number, TimelineBlock>();
  const last = new Map<number, TimelineBlock>();
  for (const block of blocks) {
    if (block.kind === "instruction") continue;
    for (const objectId of blockObjectIds(block)) {
      const earliest = first.get(objectId);
      if (!earliest || blockStartMs(block) < blockStartMs(earliest)) first.set(objectId, block);
      const latest = last.get(objectId);
      if (!latest || blockEndMs(block) > blockEndMs(latest)) last.set(objectId, block);
    }
  }
  return new Set(
    [...first.values(), ...last.values()].filter((block) => block.kind === "pose").map((block) => block.id),
  );
};

const stoppedPose = (pose: PoseBlock): PoseBlock => {
  const { passSpeedModes: _modes, ...rest } = pose;
  const passSpeeds: Partial<Record<VirtualAxisId, number>> = {};
  for (const axis of AXES) if (isAxisSet(pose.pose, axis)) passSpeeds[axis] = 0;
  return { ...rest, passSpeeds };
};

type ExpandedContent = { blocks: TimelineBlock[]; segments: MotionSegmentConfig[] };

/** 一组块里的引用（嵌套的先展开）换成里面的块：id 加前缀、时刻加上引用的起点、首尾位姿停住 */
const expandBlocks = (
  blocks: readonly TimelineBlock[],
  segments: readonly MotionSegmentConfig[],
  depth: number,
  onRefBlock?: (expandedId: string, refBlockId: string) => void,
): ExpandedContent => {
  if (!blocks.some((block) => block.kind === "sequence-ref")) {
    return { blocks: [...blocks], segments: [...segments] };
  }
  if (depth >= SEQUENCE_REF_MAX_DEPTH) throw new Error("sequence references are nested too deep");
  const outBlocks: TimelineBlock[] = [];
  const outSegments: MotionSegmentConfig[] = [...segments];
  for (const block of blocks) {
    if (block.kind !== "sequence-ref") {
      outBlocks.push(block);
      continue;
    }
    const inner = expandBlocks(block.content.blocks, block.content.segments, depth + 1);
    const stops = edgePoseIds(inner.blocks);
    for (const innerBlock of inner.blocks) {
      const id = refInnerId(block.id, innerBlock.id);
      let mapped = shiftBlock({ ...innerBlock, id }, block.atMs);
      if (mapped.kind === "pose" && stops.has(innerBlock.id)) mapped = stoppedPose(mapped);
      outBlocks.push(mapped);
      onRefBlock?.(id, block.id);
    }
    for (const config of inner.segments) {
      outSegments.push({
        ...config,
        fromRef: refSegmentRef(block.id, config.fromRef),
        toRef: refSegmentRef(block.id, config.toRef),
      });
    }
  }
  return { blocks: outBlocks, segments: outSegments };
};

export type ExpandedSequence = {
  /** 引用都换成里面的块后的序列；没有引用时就是原序列 */
  sequence: ActionSequenceConfig;
  /** 展开出来的块 id → 它所在的引用块（最外层）的 id */
  ownerOf: ReadonlyMap<string, string>;
};

/** 解析前展开引用：里面的块照常解析，解析完再把关键点、区间标成属于这个引用块 */
export const expandSequenceRefs = (sequence: ActionSequenceConfig): ExpandedSequence => {
  const ownerOf = new Map<string, string>();
  if (!sequence.blocks.some((block) => block.kind === "sequence-ref")) return { sequence, ownerOf };
  const expanded = expandBlocks(sequence.blocks, sequence.segments, 0, (id, owner) => ownerOf.set(id, owner));
  return { sequence: { ...sequence, blocks: expanded.blocks, segments: expanded.segments }, ownerOf };
};
