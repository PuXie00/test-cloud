import { clampNumeric } from "@/app/components/ics/numeric-input-utils";
import {
  cloneAxisProfiles,
  cloneMotionProfile,
  createDefaultAxisProfiles,
} from "@/app/project/action-sequence/motion-profile";
import { getPresetDefinition } from "@/app/project/action-sequence/preset-registry";
import {
  reconcileSegmentConfigs,
  resolveActionSequence,
  type ReconcileSegmentOptions,
} from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  KeyframePose,
  ModelPose,
  MotionProfile,
  MotionSegmentConfig,
  MotionSegmentSettings,
  PoseBlock,
  SetEnabledInstruction,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import type { VirtualAxisId, VirtualAxisValues } from "@/app/project/project-document-types";
import { roundProjectCoordinate } from "@/app/project/project-quantity";
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
    const current = block.pose[write.axis];
    // 相对写入跳过不设定的轴，让它继续经过；绝对写入会设定该轴
    if (write.mode === "rel" && current === undefined) continue;
    // 相对写入取到工程精度，免得浮点误差（曲线上拖值时每次都是相对拖动开始加增量）
    const nextValue =
      write.mode === "rel" ? roundProjectCoordinate((current ?? 0) + write.value) : write.value;
    const clamped = clampNumeric(nextValue, range?.min, range?.max);
    if (clamped === current) continue;
    block.pose = { ...block.pose, [write.axis]: clamped };
    changed = true;
  }
  if (!changed) return { ok: true, sequence };
  return tryFinalize(next, options);
};

/**
 * 取当前：把物体的实时位置写进位姿里设定了值的轴。
 * 经过（不设定）的轴不写，按行程截断，取到工程精度。
 */
export const updatePosesFromLive = (
  sequence: ActionSequenceConfig,
  blockIds: readonly string[],
  liveFor: (objectId: number) => VirtualAxisValues | null | undefined,
  options?: PoseAxisWriteOptions,
): EditResult => {
  const ids = new Set(blockIds);
  if (ids.size === 0) return { ok: true, sequence };

  let changed = false;
  const next = cloneSequence(sequence);
  for (const block of next.blocks) {
    if (!ids.has(block.id) || block.kind !== "pose") continue;
    const live = liveFor(block.objectId);
    if (!live) continue;
    const info = options?.objectInfo?.(block.objectId);
    const pose = { ...block.pose };
    for (const axis of resolveWriteAxes(info?.enabledAxes)) {
      const current = pose[axis];
      const value = live[axis];
      if (current === undefined || value === undefined) continue;
      const range = info?.rangeByAxis?.[axis];
      const nextValue = roundProjectCoordinate(clampNumeric(value, range?.min, range?.max));
      if (nextValue === current) continue;
      pose[axis] = nextValue;
      changed = true;
    }
    block.pose = pose;
  }
  if (!changed) return { ok: true, sequence };
  return tryFinalize(next, options);
};

/** 这些位姿里值变了的（取当前后给提示用） */
export const changedPoseIds = (
  before: ActionSequenceConfig,
  after: ActionSequenceConfig,
  blockIds: readonly string[],
): string[] =>
  blockIds.filter((id) => {
    const prev = before.blocks.find((block) => block.id === id);
    const next = after.blocks.find((block) => block.id === id);
    if (prev?.kind !== "pose" || next?.kind !== "pose") return false;
    return (["v1", "v2", "v3"] as const).some((axis) => prev.pose[axis] !== next.pose[axis]);
  });

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

/** 批量改阶段时的一条写入：某段曲线（fromRef→toRef）某个轴的新曲线 */
export type SegmentProfileWrite = {
  fromRef: string;
  toRef: string;
  axis: VirtualAxisId;
  profile: MotionProfile;
  /** 这段还没有设置时，其它轴按这个时长取默认曲线 */
  durationMs: number;
};

/** 一次写多段曲线（多选运动区间改阶段），只提交一次 */
export const writeSegmentProfiles = (
  sequence: ActionSequenceConfig,
  writes: readonly SegmentProfileWrite[],
): ActionSequenceConfig => {
  if (writes.length === 0) return sequence;
  const next = cloneSequence(sequence);
  for (const write of writes) {
    const index = next.segments.findIndex(
      (item) => item.fromRef === write.fromRef && item.toRef === write.toRef,
    );
    const base =
      index >= 0
        ? next.segments[index]!.settings.profiles
        : createDefaultAxisProfiles(write.durationMs);
    const config: MotionSegmentConfig = {
      fromRef: write.fromRef,
      toRef: write.toRef,
      settings: {
        profiles: { ...cloneAxisProfiles(base), [write.axis]: cloneMotionProfile(write.profile) },
      },
    };
    if (index >= 0) next.segments[index] = config;
    else next.segments.push(config);
  }
  return finalize(next);
};

/** 按速度改阶段时的一条写入：曲线（fromRef→toRef）某个轴的新曲线和这段曲线的新时长 */
export type SegmentRetimeWrite = {
  objectId: number;
  fromRef: string;
  toRef: string;
  axis: VirtualAxisId;
  profile: MotionProfile;
  /** 新时长（0.1 s 的整数倍）；起止时刻按 fromRef、toRef 在序列里现在的位置算 */
  durationMs: number;
};

/**
 * 按速度改阶段：曲线换成新的，时长变了的把终点挪过去，这个物体终点及以后的块跟着一起平移，
 * 后面的区间形状不变；其它物体不动（几个物体共用的预设随它平移）。
 * 一次写几段时同一物体的平移累加。新终点越过曲线中间的位姿，或平移后和别的动作重叠时不改。
 */
export const retimeSegmentCurves = (
  sequence: ActionSequenceConfig,
  writes: readonly SegmentRetimeWrite[],
  options?: SequenceEditOptions,
): EditResult => {
  if (writes.length === 0) return { ok: true, sequence };
  let resolved: ReturnType<typeof resolveActionSequence>;
  try {
    resolved = resolveActionSequence(sequence);
  } catch {
    return { ok: false, reason: "invalid-preset" };
  }
  const deltasByObject = new Map<number, Array<{ atMs: number; deltaMs: number }>>();
  for (const write of writes) {
    const points = resolved.posesByObject.get(write.objectId) ?? [];
    const startMs = points.find((point) => point.sourceRef === write.fromRef)?.atMs;
    const endMs = points.find((point) => point.sourceRef === write.toRef)?.atMs;
    if (startMs === undefined || endMs === undefined) return { ok: false, reason: "missing-block" };
    const durationMs = snapTimeMs(write.durationMs);
    if (!(durationMs > 0)) return { ok: false, reason: "invalid-time-range" };
    const deltaMs = durationMs - (endMs - startMs);
    if (deltaMs === 0) continue;
    // 轴在中间位姿经过时，新终点不能早于（或落在）中间那些位姿上
    const crossesInner = points.some(
      (point) => point.atMs > startMs && point.atMs < endMs && point.atMs >= startMs + durationMs,
    );
    if (crossesInner) return { ok: false, reason: "invalid-time-range" };
    const list = deltasByObject.get(write.objectId) ?? [];
    list.push({ atMs: endMs, deltaMs });
    deltasByObject.set(write.objectId, list);
  }
  const shiftOf = (objectId: number, atMs: number): number =>
    (deltasByObject.get(objectId) ?? []).reduce(
      (sum, item) => (item.atMs <= atMs ? sum + item.deltaMs : sum),
      0,
    );
  const next = cloneSequence(sequence);
  if (deltasByObject.size > 0) {
    next.blocks = next.blocks.map((block) => {
      const atMs = blockTimeMs(block);
      // 几个物体共用的块取变化最大的那个物体的平移
      const shift = blockObjectIds(block)
        .map((objectId) => shiftOf(objectId, atMs))
        .reduce((best, value) => (Math.abs(value) > Math.abs(best) ? value : best), 0);
      return shift === 0 ? block : snapBlockTimes(shiftBlock(block, shift));
    });
    if (next.blocks.some((block) => timeRangeError(block))) {
      return { ok: false, reason: "invalid-time-range" };
    }
  }
  for (const write of writes) {
    const index = next.segments.findIndex(
      (item) => item.fromRef === write.fromRef && item.toRef === write.toRef,
    );
    const base =
      index >= 0
        ? next.segments[index]!.settings.profiles
        : createDefaultAxisProfiles(snapTimeMs(write.durationMs));
    const config: MotionSegmentConfig = {
      fromRef: write.fromRef,
      toRef: write.toRef,
      settings: {
        profiles: { ...cloneAxisProfiles(base), [write.axis]: cloneMotionProfile(write.profile) },
      },
    };
    if (index >= 0) next.segments[index] = config;
    else next.segments.push(config);
  }
  return commitBlocks(sequence, next, options);
};

/** 位姿对齐：同时启动对齐起点，同时到达对齐终点 */
export type SegmentAlignEdge = "start" | "end";

/** 对齐到哪：某个时刻（播放游标），或选中里最早的起点 / 最晚的终点 */
export type SegmentAlignTarget = { kind: "time"; atMs: number } | { kind: "extreme" };

export type AlignSegmentsResult =
  | { ok: true; sequence: ActionSequenceConfig; movedObjectIds: number[] }
  | {
      ok: false;
      /** crosses-previous：往前会碰到这个物体前一个动作块；shared-block：共用的预设要挪的量不一样 */
      reason: SequenceEditError | "crosses-previous" | "shared-block";
      objectId?: number;
    };

const blockEndMs = (block: TimelineBlock): number =>
  block.kind === "dynamic-preset" ? block.endMs : block.atMs;

type ObjectShift = { fromMs: number; deltaMs: number };

/**
 * 对齐用的平移：每个物体从 fromMs 起的块一起挪 deltaMs。往前移不能碰到（或越过）这个物体前一个动作块，
 * 几个物体共用的块（预设）要挪的量不一样时不改。
 */
const shiftObjectsFrom = (
  sequence: ActionSequenceConfig,
  shifts: ReadonlyMap<number, ObjectShift>,
  options?: SequenceEditOptions,
): AlignSegmentsResult => {
  for (const [objectId, { fromMs, deltaMs }] of shifts) {
    if (deltaMs >= 0) continue;
    const previousEndMs = sequence.blocks
      .filter((block) => blockObjectIds(block).includes(objectId) && blockTimeMs(block) < fromMs)
      .reduce((latest, block) => Math.max(latest, blockEndMs(block)), -1);
    if (fromMs + deltaMs <= previousEndMs || fromMs + deltaMs < 0) {
      return { ok: false, reason: "crosses-previous", objectId };
    }
  }

  const movedObjectIds = [...shifts].filter(([, shift]) => shift.deltaMs !== 0).map(([id]) => id);
  if (movedObjectIds.length === 0) return { ok: true, sequence, movedObjectIds };

  const next = cloneSequence(sequence);
  let sharedConflict = false;
  next.blocks = next.blocks.map((block) => {
    const atMs = blockTimeMs(block);
    const deltas = new Set(
      blockObjectIds(block).flatMap((objectId) => {
        const shift = shifts.get(objectId);
        return shift && atMs >= shift.fromMs ? [shift.deltaMs] : [];
      }),
    );
    if (deltas.size > 1) sharedConflict = true;
    const [deltaMs = 0] = deltas;
    return deltaMs === 0 ? block : snapBlockTimes(shiftBlock(block, deltaMs));
  });
  if (sharedConflict) return { ok: false, reason: "shared-block" };
  if (next.blocks.some((block) => timeRangeError(block))) {
    return { ok: false, reason: "invalid-time-range" };
  }
  const committed = commitBlocks(sequence, next, options);
  if (!committed.ok) return committed;
  return { ok: true, sequence: committed.sequence, movedObjectIds };
};

/**
 * 位姿对齐：每个物体选中的运动区间（几段时从最早起点到最晚终点）整段平移，起点（或终点）落到同一时刻，
 * 时长不变；这个物体从这段开始往后的块一起平移。往前移不能碰到这个物体前一个动作块，
 * 几个物体共用的块（预设）要挪的量不一样时不改。
 */
export const alignMotionSegments = (
  sequence: ActionSequenceConfig,
  segmentKeys: readonly string[],
  edge: SegmentAlignEdge,
  target: SegmentAlignTarget,
  options?: SequenceEditOptions,
): AlignSegmentsResult => {
  let resolved: ReturnType<typeof resolveActionSequence>;
  try {
    resolved = resolveActionSequence(sequence);
  } catch {
    return { ok: false, reason: "invalid-preset" };
  }
  const keys = new Set(segmentKeys);
  const spans = new Map<number, { startMs: number; endMs: number; fromRef: string }>();
  for (const segment of resolved.segments) {
    if (!keys.has(segment.key)) continue;
    const span = spans.get(segment.objectId);
    if (!span) {
      spans.set(segment.objectId, {
        startMs: segment.startMs,
        endMs: segment.endMs,
        fromRef: segment.fromRef,
      });
      continue;
    }
    if (segment.startMs < span.startMs) {
      span.startMs = segment.startMs;
      span.fromRef = segment.fromRef;
    }
    span.endMs = Math.max(span.endMs, segment.endMs);
  }
  if (spans.size === 0) return { ok: false, reason: "missing-block" };

  const edgeMs = (span: { startMs: number; endMs: number }) =>
    edge === "start" ? span.startMs : span.endMs;
  const targetMs = snapTimeMs(
    target.kind === "time"
      ? target.atMs
      : edge === "start"
        ? Math.min(...[...spans.values()].map(edgeMs))
        : Math.max(...[...spans.values()].map(edgeMs)),
  );

  // 起点在预设里时整个预设一起挪：从产生起点的那个块的时刻开始平移
  const shifts = new Map<number, ObjectShift>();
  for (const [objectId, span] of spans) {
    const sourceBlockId = resolved.poses.find((point) => point.sourceRef === span.fromRef)?.sourceBlockId;
    const source = sequence.blocks.find((block) => block.id === sourceBlockId);
    const fromMs = Math.min(span.startMs, source ? blockTimeMs(source) : span.startMs);
    shifts.set(objectId, { fromMs, deltaMs: targetMs - edgeMs(span) });
  }
  return shiftObjectsFrom(sequence, shifts, options);
};

/** 单个位姿对齐到哪：播放游标的时刻，或选中位姿里最早 / 最晚的 */
export type PoseAlignTarget =
  | { kind: "time"; atMs: number }
  | { kind: "earliest" }
  | { kind: "latest" };

/**
 * 位姿对齐（只选了位姿、每个物体一个）：选中的位姿挪到同一时刻，这个物体后面的块一起平移，
 * 到达这个位姿的那段时长跟着变。往前移不能碰到这个物体前一个动作块。
 */
export const alignPoseBlocks = (
  sequence: ActionSequenceConfig,
  blockIds: readonly string[],
  target: PoseAlignTarget,
  options?: SequenceEditOptions,
): AlignSegmentsResult => {
  const ids = new Set(blockIds);
  const poses = sequence.blocks.filter(
    (block): block is PoseBlock => block.kind === "pose" && ids.has(block.id),
  );
  if (poses.length === 0) return { ok: false, reason: "missing-block" };
  if (new Set(poses.map((pose) => pose.objectId)).size !== poses.length) {
    return { ok: false, reason: "time-conflict" };
  }
  const times = poses.map((pose) => pose.atMs);
  const targetMs = snapTimeMs(
    target.kind === "time"
      ? target.atMs
      : target.kind === "earliest"
        ? Math.min(...times)
        : Math.max(...times),
  );
  return shiftObjectsFrom(
    sequence,
    new Map(poses.map((pose) => [pose.objectId, { fromMs: pose.atMs, deltaMs: targetMs - pose.atMs }])),
    options,
  );
};

export type ExplodeResult =
  | { ok: true; sequence: ActionSequenceConfig; createdIds: string[] }
  | { ok: false; reason: SequenceEditError };

const isPresetBlock = (block: TimelineBlock): boolean =>
  block.kind === "static-preset" || block.kind === "dynamic-preset";

/**
 * 拆解预设：换成它在各物体上的关键点位姿，时刻和位置不变；行进波浪错开等待时的隐藏保持点
 * 只在影响运动时才生成。
 * 预设管的轴照填；不管的轴在这之前真正设过值（位姿设了值，或别的预设管这个轴）就照沿用的值填，
 * 只是占位的不填，拆完这个轴不受控或经过。预设内部各段沿用预设的加减速时间，
 * 前后相邻区间的设置跟着换到新位姿上。
 */
export const explodePresetBlocks = (
  sequence: ActionSequenceConfig,
  blockIds: readonly string[],
  options?: SequenceEditOptions,
): ExplodeResult => {
  const targetIds = new Set(
    sequence.blocks
      .filter((block) => blockIds.includes(block.id) && isPresetBlock(block))
      .map((block) => block.id),
  );
  if (targetIds.size === 0) return { ok: false, reason: "missing-block" };
  let resolved: ReturnType<typeof resolveActionSequence>;
  try {
    resolved = resolveActionSequence(sequence);
  } catch {
    return { ok: false, reason: "invalid-preset" };
  }

  const ownedAxesOf = (blockId: string | null): readonly VirtualAxisId[] => {
    const block = sequence.blocks.find((item) => item.id === blockId);
    if (!block || (block.kind !== "static-preset" && block.kind !== "dynamic-preset")) return [];
    return getPresetDefinition(block.presetId)?.ownedAxes ?? [];
  };
  // 每个物体每个轴第一次真正设定的时刻；预设沿用的值、保持点不算
  const firstSetMs = new Map<string, number>();
  for (const point of resolved.poses) {
    for (const axis of ALL_VIRTUAL_AXES) {
      const set =
        point.sourceKind === "pose"
          ? !point.unsetAxes?.includes(axis)
          : point.visible && ownedAxesOf(point.sourceBlockId).includes(axis);
      if (!set) continue;
      const key = `${point.objectId}:${axis}`;
      firstSetMs.set(key, Math.min(firstSetMs.get(key) ?? Number.POSITIVE_INFINITY, point.atMs));
    }
  }

  // 行进波浪错开起步、提前结束时的隐藏保持点：下一个点和它一样时有没有它运动都不变，不生成；
  // 只有后面还要换位置（得等预设结束再走）、或起步前要先走到基准时才保留
  const samePose = (left: ModelPose, right: ModelPose) =>
    ALL_VIRTUAL_AXES.every((axis) => Math.abs(left[axis] - right[axis]) < 1e-6);
  const holdMatters = (point: (typeof resolved.poses)[number]): boolean => {
    const series = resolved.posesByObject.get(point.objectId) ?? [];
    const next = series[series.indexOf(point) + 1];
    return next !== undefined && !samePose(point.pose, next.pose);
  };

  const existingIds = new Set(sequence.blocks.map((block) => block.id));
  const blockIdByRef = new Map<string, string>();
  const posesByPreset = new Map<string, PoseBlock[]>();
  for (const point of resolved.poses) {
    if (point.sourceBlockId === null || !targetIds.has(point.sourceBlockId)) continue;
    if (!point.visible && !holdMatters(point)) continue;
    const owned = ownedAxesOf(point.sourceBlockId);
    const pose: KeyframePose = {};
    for (const axis of ALL_VIRTUAL_AXES) {
      const keep =
        owned.includes(axis) ||
        (firstSetMs.get(`${point.objectId}:${axis}`) ?? Number.POSITIVE_INFINITY) < point.atMs;
      if (keep) pose[axis] = roundProjectCoordinate(point.pose[axis]);
    }
    const id = nextBlockId(existingIds);
    existingIds.add(id);
    blockIdByRef.set(point.sourceRef, id);
    const list = posesByPreset.get(point.sourceBlockId) ?? [];
    list.push({ id, kind: "pose", objectId: point.objectId, atMs: point.atMs, pose });
    posesByPreset.set(point.sourceBlockId, list);
  }

  const next = cloneSequence(sequence);
  next.blocks = next.blocks.flatMap((block) =>
    targetIds.has(block.id) ? (posesByPreset.get(block.id) ?? []) : [block],
  );
  const remap = (ref: string) => blockIdByRef.get(ref) ?? ref;
  next.segments = next.segments.map((config) => ({
    ...config,
    fromRef: remap(config.fromRef),
    toRef: remap(config.toRef),
  }));
  for (const segment of resolved.segments) {
    if (!segment.ownerPresetBlockId || !targetIds.has(segment.ownerPresetBlockId)) continue;
    const fromRef = blockIdByRef.get(segment.fromRef);
    const toRef = blockIdByRef.get(segment.toRef);
    if (fromRef === undefined || toRef === undefined) continue;
    next.segments.push({ fromRef, toRef, settings: cloneSettings(segment.settings) });
  }

  const committed = commitBlocks(sequence, next, options);
  if (!committed.ok) return committed;
  return {
    ok: true,
    sequence: committed.sequence,
    createdIds: [...posesByPreset.values()].flat().map((block) => block.id),
  };
};
