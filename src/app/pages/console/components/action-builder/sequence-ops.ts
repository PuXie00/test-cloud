import { clampNumeric } from "@/app/components/ics/numeric-input-utils";
import { cloneAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import { getPresetDefinition } from "@/app/project/action-sequence/preset-registry";
import {
  reconcileSegmentConfigs,
  resolveActionSequence,
  type ReconcileSegmentOptions,
} from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  MotionSegmentConfig,
  MotionSegmentSettings,
  PoseBlock,
  SetEnabledInstruction,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { snapTimeMs } from "./timeline/timeline-data";

export type SequenceEditError =
  | "motion-overlap"
  /** 同一物体同一时刻已有动作块（位姿、预设关键点或同类指令） */
  | "time-conflict"
  | "missing-block"
  | "invalid-time-range"
  | "invalid-preset";

export type EditResult =
  | { ok: true; sequence: ActionSequenceConfig }
  | { ok: false; reason: SequenceEditError };

export type PasteResult =
  | {
      ok: true;
      sequence: ActionSequenceConfig;
      createdIds: string[];
      /** 物体映射不到而没有粘贴的块数 */
      droppedBlocks: number;
    }
  | { ok: false; reason: SequenceEditError };

/** 复制下来的一组块，连同两端都在这组块里的运动区间设置 */
export type TimelineClipboard = {
  blocks: TimelineBlock[];
  segments: MotionSegmentConfig[];
};

/** 源物体 id → 目标物体 id；不在表里的物体上的块不粘贴 */
export type ObjectIdMap = ReadonlyMap<number, number>;

export type SequenceEditOptions = ReconcileSegmentOptions;

export type PoseAxisWrite = {
  mode: "abs" | "rel";
  axis: VirtualAxisId;
  value: number;
};

export type PoseAxisObjectInfo = {
  enabledAxes?: readonly VirtualAxisId[];
  rangeByAxis?: Partial<Record<VirtualAxisId, { min: number; max: number }>>;
};

export type PoseAxisWriteOptions = SequenceEditOptions & {
  objectInfo?: (objectId: number) => PoseAxisObjectInfo | undefined;
};

const ALL_VIRTUAL_AXES: VirtualAxisId[] = ["v1", "v2", "v3"];

const resolveWriteAxes = (enabledAxes?: readonly VirtualAxisId[]): VirtualAxisId[] =>
  enabledAxes !== undefined && enabledAxes.length > 0 ? [...enabledAxes] : [...ALL_VIRTUAL_AXES];

type MotionSpan =
  | { kind: "point"; objectId: number; atMs: number }
  | { kind: "range"; objectId: number; startMs: number; endMs: number };

const uniqueIds = (ids: number[]): number[] => [...new Set(ids)];

const cloneSequence = (sequence: ActionSequenceConfig): ActionSequenceConfig => structuredClone(sequence);

const cloneBlock = (block: TimelineBlock): TimelineBlock => structuredClone(block);

const cloneSettings = (settings: MotionSegmentSettings): MotionSegmentSettings => ({
  profiles: cloneAxisProfiles(settings.profiles),
});

const nextBlockId = (existing: ReadonlySet<string>): string => {
  let id = "";
  do {
    id = `blk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } while (existing.has(id));
  return id;
};

const blockTimeMs = (block: TimelineBlock): number =>
  block.kind === "dynamic-preset" ? block.startMs : block.atMs;

const shiftBlock = (block: TimelineBlock, deltaMs: number): TimelineBlock => {
  if (block.kind === "dynamic-preset") {
    return { ...block, startMs: block.startMs + deltaMs, endMs: block.endMs + deltaMs };
  }
  return { ...block, atMs: block.atMs + deltaMs };
};

const moveBlockTo = (block: TimelineBlock, atMs: number): TimelineBlock => {
  if (block.kind === "dynamic-preset") {
    const durationMs = block.endMs - block.startMs;
    return { ...block, startMs: atMs, endMs: atMs + durationMs };
  }
  return { ...block, atMs };
};

const snapBlockTimes = (block: TimelineBlock): TimelineBlock => {
  if (block.kind === "dynamic-preset") {
    return {
      ...block,
      startMs: snapTimeMs(block.startMs),
      endMs: snapTimeMs(block.endMs),
    };
  }
  return { ...block, atMs: snapTimeMs(block.atMs) };
};

const motionSpans = (sequence: ActionSequenceConfig): MotionSpan[] => {
  const spans: MotionSpan[] = [];
  for (const block of sequence.blocks) {
    if (block.kind === "pose") {
      spans.push({ kind: "point", objectId: block.objectId, atMs: block.atMs });
      continue;
    }
    if (block.kind === "static-preset") {
      for (const objectId of uniqueIds(block.orderedObjectIds)) {
        spans.push({ kind: "point", objectId, atMs: block.atMs });
      }
      continue;
    }
    if (block.kind === "dynamic-preset") {
      for (const objectId of uniqueIds(block.orderedObjectIds)) {
        spans.push({
          kind: "range",
          objectId,
          startMs: block.startMs,
          endMs: block.endMs,
        });
      }
    }
  }
  return spans;
};

const spansOverlap = (left: MotionSpan, right: MotionSpan): boolean => {
  if (left.kind === "range" && right.kind === "range") {
    return Math.max(left.startMs, right.startMs) < Math.min(left.endMs, right.endMs);
  }
  if (left.kind === "point" && right.kind === "range") {
    return right.startMs < left.atMs && left.atMs < right.endMs;
  }
  if (left.kind === "range" && right.kind === "point") {
    return left.startMs < right.atMs && right.atMs < left.endMs;
  }
  return false;
};

const hasMotionOverlap = (sequence: ActionSequenceConfig): boolean => {
  const byObject = new Map<number, MotionSpan[]>();
  for (const span of motionSpans(sequence)) {
    const list = byObject.get(span.objectId);
    if (list) list.push(span);
    else byObject.set(span.objectId, [span]);
  }
  for (const spans of byObject.values()) {
    for (let i = 0; i < spans.length; i += 1) {
      for (let j = i + 1; j < spans.length; j += 1) {
        const left = spans[i];
        const right = spans[j];
        if (left === undefined || right === undefined) continue;
        if (spansOverlap(left, right)) return true;
      }
    }
  }
  return false;
};

const isInvalidTime = (value: number): boolean => !Number.isFinite(value) || value < 0;

const timeRangeError = (block: TimelineBlock): SequenceEditError | null => {
  if (block.kind === "dynamic-preset") {
    if (isInvalidTime(block.startMs) || isInvalidTime(block.endMs) || block.endMs <= block.startMs) {
      return "invalid-time-range";
    }
    return null;
  }
  if (isInvalidTime(block.atMs)) return "invalid-time-range";
  return null;
};

const presetError = (block: TimelineBlock): SequenceEditError | null => {
  if (block.kind !== "static-preset" && block.kind !== "dynamic-preset") return null;
  const definition = getPresetDefinition(block.presetId);
  if (!definition) return "invalid-preset";
  const expectedKind = definition.kind === "static" ? "static-preset" : "dynamic-preset";
  if (block.kind !== expectedKind) return "invalid-preset";
  const seen = new Set<number>();
  for (const objectId of block.orderedObjectIds) {
    if (seen.has(objectId)) return "invalid-preset";
    seen.add(objectId);
  }
  if (block.orderedObjectIds.length < definition.minObjects) return "invalid-preset";
  if (definition.maxObjects !== undefined && block.orderedObjectIds.length > definition.maxObjects) {
    return "invalid-preset";
  }
  if (definition.validateParams(block.params).length > 0) return "invalid-preset";
  return null;
};

const blockError = (block: TimelineBlock): SequenceEditError | null =>
  timeRangeError(block) ?? presetError(block);

const finalize = (
  sequence: ActionSequenceConfig,
  options?: SequenceEditOptions,
): ActionSequenceConfig => {
  try {
    const resolved = resolveActionSequence(sequence);
    return {
      ...sequence,
      segments: reconcileSegmentConfigs(resolved.segments, sequence.segments, options),
    };
  } catch {
    return sequence;
  }
};

const tryFinalize = (
  sequence: ActionSequenceConfig,
  options?: SequenceEditOptions,
): EditResult => {
  try {
    return { ok: true, sequence: finalize(sequence, options) };
  } catch {
    return { ok: false, reason: "invalid-preset" };
  }
};

/**
 * 同一物体同一时刻的重复动作：运动关键点重复（与校验的 duplicate-pose-time 一致），
 * 或同类指令重复。键为「类别:物体@时刻」。
 */
const sameTimeKeys = (sequence: ActionSequenceConfig): Set<string> => {
  const keys = new Set<string>();
  try {
    for (const [objectId, points] of resolveActionSequence(sequence).posesByObject) {
      for (let index = 0; index < points.length - 1; index += 1) {
        const atMs = points[index]?.atMs;
        if (atMs !== undefined && atMs === points[index + 1]?.atMs) {
          keys.add(`pose:${objectId}@${atMs}`);
        }
      }
    }
  } catch {
    // 预设解析失败时由 tryFinalize / 校验处理
  }
  const instructions = new Set<string>();
  for (const block of sequence.blocks) {
    if (block.kind !== "instruction") continue;
    const key = `${block.presetId}:${block.objectId}@${block.atMs}`;
    if (instructions.has(key)) keys.add(key);
    instructions.add(key);
  }
  return keys;
};

/** 这次编辑新增了同一时刻的重复动作（原本就有的重复不算，避免老数据一改就被拦） */
const introducesSameTimeConflict = (
  previous: ActionSequenceConfig,
  next: ActionSequenceConfig,
): boolean => {
  const before = sameTimeKeys(previous);
  for (const key of sameTimeKeys(next)) {
    if (!before.has(key)) return true;
  }
  return false;
};

const commitBlocks = (
  previous: ActionSequenceConfig,
  sequence: ActionSequenceConfig,
  options?: SequenceEditOptions,
): EditResult => {
  if (hasMotionOverlap(sequence)) return { ok: false, reason: "motion-overlap" };
  if (introducesSameTimeConflict(previous, sequence)) return { ok: false, reason: "time-conflict" };
  return tryFinalize(sequence, options);
};

export const insertTimelineBlock = (
  sequence: ActionSequenceConfig,
  block: TimelineBlock,
  options?: SequenceEditOptions,
): EditResult => {
  const snapped = snapBlockTimes(block);
  const error = blockError(snapped);
  if (error) return { ok: false, reason: error };
  const next = cloneSequence(sequence);
  next.blocks.push(cloneBlock(snapped));
  return commitBlocks(sequence, next, options);
};

export type UpsertResult =
  | { ok: true; sequence: ActionSequenceConfig; blockId: string; updated: boolean }
  | { ok: false; reason: SequenceEditError };

const upsertAtTime = <T extends PoseBlock | SetEnabledInstruction>(
  sequence: ActionSequenceConfig,
  block: T,
  isSame: (existing: TimelineBlock, atMs: number) => existing is T,
  update: (existing: T) => T,
  options?: SequenceEditOptions,
): UpsertResult => {
  const atMs = snapTimeMs(block.atMs);
  const existing = sequence.blocks.find((item): item is T => isSame(item, atMs));
  if (existing) {
    const replaced = replaceTimelineBlock(sequence, update(existing), options);
    return replaced.ok
      ? { ok: true, sequence: replaced.sequence, blockId: existing.id, updated: true }
      : replaced;
  }
  const inserted = insertTimelineBlock(sequence, block, options);
  return inserted.ok
    ? { ok: true, sequence: inserted.sequence, blockId: block.id, updated: false }
    : inserted;
};

/**
 * 新建位姿：该物体在这一时刻已有位姿就更新它的数值（保留原块和前后的运动区间设置），
 * 否则新建；这一时刻是预设关键点等其他动作时拒绝（time-conflict）。
 */
export const upsertPoseBlock = (
  sequence: ActionSequenceConfig,
  block: PoseBlock,
  options?: SequenceEditOptions,
): UpsertResult =>
  upsertAtTime(
    sequence,
    block,
    (existing, atMs): existing is PoseBlock =>
      existing.kind === "pose" && existing.objectId === block.objectId && existing.atMs === atMs,
    (existing) => ({ ...existing, pose: { ...block.pose } }),
    options,
  );

/** 新建使能 / 断使能：该物体在这一时刻已有同类指令就更新，否则新建 */
export const upsertSetEnabledBlock = (
  sequence: ActionSequenceConfig,
  block: SetEnabledInstruction,
  options?: SequenceEditOptions,
): UpsertResult =>
  upsertAtTime(
    sequence,
    block,
    (existing, atMs): existing is SetEnabledInstruction =>
      existing.kind === "instruction" &&
      existing.presetId === block.presetId &&
      existing.objectId === block.objectId &&
      existing.atMs === atMs,
    (existing) => ({ ...existing, instr: { ...block.instr } }),
    options,
  );

export const applyPoseAxisWrite = (
  sequence: ActionSequenceConfig,
  blockIds: readonly string[],
  write: PoseAxisWrite,
  options?: PoseAxisWriteOptions,
): EditResult => {
  const ids = new Set(blockIds);
  if (ids.size === 0) return { ok: true, sequence };

  let changed = false;
  const next = cloneSequence(sequence);
  for (const block of next.blocks) {
    if (!ids.has(block.id) || block.kind !== "pose") continue;
    const info = options?.objectInfo?.(block.objectId);
    if (!resolveWriteAxes(info?.enabledAxes).includes(write.axis)) continue;
    const range = info?.rangeByAxis?.[write.axis];
    const nextValue = write.mode === "rel" ? block.pose[write.axis] + write.value : write.value;
    const clamped = clampNumeric(nextValue, range?.min, range?.max);
    if (clamped === block.pose[write.axis]) continue;
    block.pose = { ...block.pose, [write.axis]: clamped };
    changed = true;
  }
  if (!changed) return { ok: true, sequence };
  return tryFinalize(next, options);
};

export const replaceTimelineBlock = (
  sequence: ActionSequenceConfig,
  replacement: TimelineBlock,
  options?: SequenceEditOptions,
): EditResult => {
  const index = sequence.blocks.findIndex((block) => block.id === replacement.id);
  if (index < 0) return { ok: false, reason: "missing-block" };
  const snapped = snapBlockTimes(replacement);
  const error = blockError(snapped);
  if (error) return { ok: false, reason: error };
  const next = cloneSequence(sequence);
  next.blocks[index] = cloneBlock(snapped);
  return commitBlocks(sequence, next, options);
};

export const moveTimelineBlock = (
  sequence: ActionSequenceConfig,
  blockId: string,
  atMs: number,
  options?: SequenceEditOptions,
): ActionSequenceConfig => {
  const index = sequence.blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return sequence;
  const current = sequence.blocks[index];
  if (current === undefined) return sequence;
  const moved = snapBlockTimes(moveBlockTo(cloneBlock(current), atMs));
  if (timeRangeError(moved)) return sequence;
  const next = cloneSequence(sequence);
  next.blocks[index] = moved;
  const committed = commitBlocks(sequence, next, options);
  if (!committed.ok) return sequence;
  return committed.sequence;
};

export const shiftTimelineBlocks = (
  sequence: ActionSequenceConfig,
  blockIds: readonly string[],
  deltaMs: number,
  options?: SequenceEditOptions,
): ActionSequenceConfig => {
  const ids = new Set(blockIds);
  if (ids.size === 0) return sequence;
  const selected = sequence.blocks.filter((block) => ids.has(block.id));
  if (selected.length === 0) return sequence;
  const minTime = Math.min(...selected.map(blockTimeMs));
  const clampedDelta = Math.max(deltaMs, -minTime);
  if (clampedDelta === 0) return sequence;
  const next = cloneSequence(sequence);
  next.blocks = next.blocks.map((block) =>
    ids.has(block.id) ? snapBlockTimes(shiftBlock(block, clampedDelta)) : block,
  );
  const committed = commitBlocks(sequence, next, options);
  if (!committed.ok) return sequence;
  return committed.sequence;
};

export const resizeDynamicPreset = (
  sequence: ActionSequenceConfig,
  blockId: string,
  startMs: number,
  endMs: number,
  options?: SequenceEditOptions,
): EditResult => {
  const index = sequence.blocks.findIndex((block) => block.id === blockId);
  const current = index >= 0 ? sequence.blocks[index] : undefined;
  if (current === undefined || current.kind !== "dynamic-preset") {
    return { ok: false, reason: "missing-block" };
  }
  const snappedStart = snapTimeMs(startMs);
  const snappedEnd = snapTimeMs(endMs);
  if (isInvalidTime(snappedStart) || isInvalidTime(snappedEnd) || snappedEnd <= snappedStart) {
    return { ok: false, reason: "invalid-time-range" };
  }
  const next = cloneSequence(sequence);
  const resized = next.blocks[index];
  if (resized === undefined || resized.kind !== "dynamic-preset") {
    return { ok: false, reason: "missing-block" };
  }
  resized.startMs = snappedStart;
  resized.endMs = snappedEnd;
  return commitBlocks(sequence, next, options);
};

export const deleteTimelineBlocks = (
  sequence: ActionSequenceConfig,
  blockIds: string[],
  options?: SequenceEditOptions,
): ActionSequenceConfig => {
  const ids = new Set(blockIds);
  if (ids.size === 0) return sequence;
  const next = cloneSequence(sequence);
  next.blocks = next.blocks.filter((block) => !ids.has(block.id));
  if (next.blocks.length === sequence.blocks.length) return sequence;
  return finalize(next, options);
};

const PRESET_REF_PREFIX = "preset:";

type SegmentRef = { blockId: string; objectId?: number; rest?: string };

/** 运动区间端点：位姿块是块 id；预设关键点是 preset:<块 id>:<物体 id>:<序号> */
const parseSegmentRef = (ref: string): SegmentRef => {
  if (!ref.startsWith(PRESET_REF_PREFIX)) return { blockId: ref };
  const [blockId = "", objectId, ...rest] = ref.slice(PRESET_REF_PREFIX.length).split(":");
  return { blockId, objectId: Number(objectId), rest: rest.join(":") };
};

const formatSegmentRef = (ref: SegmentRef): string =>
  ref.objectId === undefined
    ? ref.blockId
    : `${PRESET_REF_PREFIX}${ref.blockId}:${ref.objectId}:${ref.rest ?? ""}`;

const blockObjectIds = (block: TimelineBlock): number[] =>
  block.kind === "pose" || block.kind === "instruction" ? [block.objectId] : block.orderedObjectIds;

/** 块用到的全部物体 id，按出现顺序去重 */
export const timelineClipboardObjectIds = (clipboard: TimelineClipboard): number[] =>
  uniqueIds(clipboard.blocks.flatMap(blockObjectIds));

export const copyTimelineBlocks = (
  sequence: ActionSequenceConfig,
  blockIds: string[],
): TimelineClipboard => {
  const ids = new Set(blockIds);
  const blocks = sequence.blocks.filter((block) => ids.has(block.id)).map(cloneBlock);
  const copied = new Set(blocks.map((block) => block.id));
  // 两端都在复制范围内的区间（相连的两个块之间）一起带走
  const segments = sequence.segments
    .filter(
      (segment) =>
        copied.has(parseSegmentRef(segment.fromRef).blockId) &&
        copied.has(parseSegmentRef(segment.toRef).blockId),
    )
    .map((segment) => ({ ...segment, settings: cloneSettings(segment.settings) }));
  return { blocks, segments };
};

/**
 * 把一组块换到新的块 id 和物体上，区间端点跟着改写。
 * 物体映射不到的块不要；预设块只要有一个物体映射不到就整块不要（预设的效果依赖整组物体）。
 */
export const remapTimelineClipboard = (
  clipboard: TimelineClipboard,
  objectMap: ObjectIdMap,
  blockIdFor: (sourceId: string) => string,
): { clipboard: TimelineClipboard; droppedBlocks: number } => {
  const blockIds = new Map<string, string>();
  const blocks: TimelineBlock[] = [];
  for (const source of clipboard.blocks) {
    const objectIds = blockObjectIds(source).map((objectId) => objectMap.get(objectId));
    if (objectIds.some((objectId) => objectId === undefined)) continue;
    const id = blockIdFor(source.id);
    blockIds.set(source.id, id);
    const block = cloneBlock(source);
    if (block.kind === "pose" || block.kind === "instruction") {
      blocks.push({ ...block, id, objectId: objectIds[0]! });
    } else {
      blocks.push({ ...block, id, orderedObjectIds: objectIds as number[] });
    }
  }
  const remapRef = (ref: string): string | null => {
    const parsed = parseSegmentRef(ref);
    const blockId = blockIds.get(parsed.blockId);
    if (blockId === undefined) return null;
    if (parsed.objectId === undefined) return formatSegmentRef({ blockId });
    const objectId = objectMap.get(parsed.objectId);
    if (objectId === undefined) return null;
    return formatSegmentRef({ ...parsed, blockId, objectId });
  };
  const segments = clipboard.segments.flatMap((segment) => {
    const fromRef = remapRef(segment.fromRef);
    const toRef = remapRef(segment.toRef);
    if (fromRef === null || toRef === null) return [];
    return [{ fromRef, toRef, settings: cloneSettings(segment.settings) }];
  });
  return {
    clipboard: { blocks, segments },
    droppedBlocks: clipboard.blocks.length - blocks.length,
  };
};

/** 重新对齐运动区间设置（新增区间补默认值、已有区间按行程同步） */
export const finalizeSequenceSegments = (
  sequence: ActionSequenceConfig,
  options?: SequenceEditOptions,
): ActionSequenceConfig => finalize(sequence, options);

/**
 * 粘贴到播放头位置：整组块平移，最早的块对齐播放头。
 * objectMaps 每一项粘贴一份（比如粘贴到多个选中的物体上）；不传时粘贴回原来的物体。
 */
export const pasteTimelineBlocks = (
  sequence: ActionSequenceConfig,
  clipboard: TimelineClipboard,
  playheadMs: number,
  options?: SequenceEditOptions,
  objectMaps?: readonly ObjectIdMap[],
): PasteResult => {
  if (clipboard.blocks.length === 0) {
    return {
      ok: true,
      sequence: finalize(cloneSequence(sequence), options),
      createdIds: [],
      droppedBlocks: 0,
    };
  }
  const maps = objectMaps ?? [
    new Map(timelineClipboardObjectIds(clipboard).map((objectId) => [objectId, objectId])),
  ];
  const originMs = Math.min(...clipboard.blocks.map(blockTimeMs));
  const deltaMs = playheadMs - originMs;
  const existingIds = new Set(sequence.blocks.map((block) => block.id));
  const createdIds: string[] = [];
  let droppedBlocks = 0;
  const next = cloneSequence(sequence);
  for (const objectMap of maps) {
    const remapped = remapTimelineClipboard(clipboard, objectMap, () => {
      const id = nextBlockId(existingIds);
      existingIds.add(id);
      return id;
    });
    droppedBlocks += remapped.droppedBlocks;
    for (const source of remapped.clipboard.blocks) {
      const shifted = snapBlockTimes(shiftBlock(source, deltaMs));
      const error = blockError(shifted);
      if (error) return { ok: false, reason: error };
      createdIds.push(shifted.id);
      next.blocks.push(shifted);
    }
    next.segments.push(...remapped.clipboard.segments);
  }
  const committed = commitBlocks(sequence, next, options);
  if (!committed.ok) return committed;
  return { ok: true, sequence: committed.sequence, createdIds, droppedBlocks };
};

export const updateSegmentSettings = (
  sequence: ActionSequenceConfig,
  fromRef: string,
  toRef: string,
  settings: MotionSegmentSettings,
): ActionSequenceConfig => {
  const next = cloneSequence(sequence);
  const config = { fromRef, toRef, settings: cloneSettings(settings) };
  const index = next.segments.findIndex((item) => item.fromRef === fromRef && item.toRef === toRef);
  if (index >= 0) next.segments[index] = config;
  else next.segments.push(config);
  return finalize(next);
};
