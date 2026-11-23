import { clampNumeric } from "@/app/components/ics/numeric-input-utils";
import {
  cloneAxisProfiles,
  cloneMotionProfile,
  createDefaultAxisProfiles,
} from "@/app/project/action-sequence/motion-profile";
import { getPresetDefinition } from "@/app/project/action-sequence/preset-registry";
import { axisMotionShape, axisMotionValueAt } from "@/app/project/action-sequence/axis-motion";
import { evaluateResolvedSequence } from "@/app/project/action-sequence/evaluate-sequence";
import { expandSequenceRefs } from "@/app/project/action-sequence/sequence-ref-expand";
import { buildSequenceRefBlock, refContentAsSequence } from "@/app/project/action-sequence/sequence-ref";
import { sequenceShape } from "@/app/project/action-sequence/sequence-shape";
import {
  isPassThroughMotion,
  reconcileSegmentConfigs,
  resolveActionSequence,
  segmentAxisMotion,
  uncontrolledAxesOf,
  type ReconcileSegmentOptions,
} from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  KeyframePose,
  ModelPose,
  MotionProfile,
  MotionSegmentConfig,
  MotionSegmentSettings,
  PassSpeedMode,
  PoseBlock,
  SetEnabledInstruction,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import type { VirtualAxisId, VirtualAxisValues } from "@/app/project/project-document-types";
import { roundProjectCoordinate } from "@/app/project/project-quantity";
import { planShapeTransition } from "./shape-transition";
import { TIME_STEP_MS, snapTimeMs, type ControlledObject } from "./timeline/timeline-data";

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
    if (block.kind === "dynamic-preset" || block.kind === "sequence-ref") {
      const startMs = blockTimeMs(block);
      const endMs = blockEndMs(block);
      for (const objectId of uniqueIds(block.orderedObjectIds)) {
        spans.push({ kind: "range", objectId, startMs, endMs });
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
    // 引用的序列只能贴回原来的物体（里面的内容换不了物体）
    if (source.kind === "sequence-ref" && objectIds.some((objectId, index) => objectId !== source.orderedObjectIds[index])) {
      continue;
    }
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
    // 同一段的几个轴一起改时长：终点只挪一次，时长对不上就不改
    const sameEnd = list.find((item) => item.atMs === endMs);
    if (sameEnd) {
      if (sameEnd.deltaMs !== deltaMs) return { ok: false, reason: "invalid-time-range" };
      continue;
    }
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

function blockEndMs(block: TimelineBlock): number {
  if (block.kind === "dynamic-preset") return block.endMs;
  if (block.kind === "sequence-ref") return block.atMs + block.durationMs;
  return block.atMs;
}

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

/** 整体缩放：选中的块从最早开始到最晚结束，按新的总时长等比伸缩 */
export type ScaleBlocksRequest = {
  blockIds: readonly string[];
  /** 新的总时长，落在 0.1 s 上 */
  durationMs: number;
  /** 没选中的物体在选区之后的块、标记也一起挪（区内的标记一起伸缩） */
  shiftAll?: boolean;
};

export type ScaleBlocksRefusal =
  /** 选中的块不到两个时刻，没有可缩放的时长 */
  | "nothing-to-scale"
  /** 缩短后这一段放不下加减速（至少各 0.1 s） */
  | "phase-too-short"
  /** 往前会碰到（或越过）这个物体前一个动作块 */
  | "crosses-previous"
  /** 几个物体共用的预设要挪的量不一样 */
  | "shared-block"
  | SequenceEditError;

export type ScaleBlocksResult =
  | { ok: true; sequence: ActionSequenceConfig; factor: number }
  | { ok: false; reason: ScaleBlocksRefusal; objectId?: number; atMs?: number };

/** 选中块的时间范围：最早开始到最晚结束；没选中块时为 null */
export const blocksSpanMs = (
  sequence: Pick<ActionSequenceConfig, "blocks">,
  blockIds: readonly string[],
): { startMs: number; endMs: number } | null => {
  const ids = new Set(blockIds);
  const selected = sequence.blocks.filter((block) => ids.has(block.id));
  if (selected.length === 0) return null;
  return {
    startMs: Math.min(...selected.map(blockTimeMs)),
    endMs: Math.max(...selected.map(blockEndMs)),
  };
};

type ScalePlacement = { kind: "scale" } | { kind: "shift"; deltaMs: number } | { kind: "keep" } | { kind: "straddle" };

const samePlacement = (left: ScalePlacement, right: ScalePlacement): boolean =>
  left.kind === right.kind &&
  (left.kind !== "shift" || (right.kind === "shift" && left.deltaMs === right.deltaMs));

const scaleTrapezoid = (profile: MotionProfile, factor: number): MotionProfile =>
  profile.kind !== "trapezoid"
    ? cloneMotionProfile(profile)
    : {
        kind: "trapezoid",
        params: {
          accelMs: Math.max(TIME_STEP_MS, snapTimeMs(profile.params.accelMs * factor)),
          decelMs: Math.max(TIME_STEP_MS, snapTimeMs(profile.params.decelMs * factor)),
        },
      };

const scaleAxisProfiles = (
  profiles: MotionSegmentSettings["profiles"],
  factor: number,
): MotionSegmentSettings["profiles"] => ({
  v1: scaleTrapezoid(profiles.v1, factor),
  v2: scaleTrapezoid(profiles.v2, factor),
  v3: scaleTrapezoid(profiles.v3, factor),
});

const profilesFit = (profiles: MotionSegmentSettings["profiles"], durationMs: number): boolean =>
  ALL_VIRTUAL_AXES.every((axis) => {
    const profile = profiles[axis];
    return profile.kind !== "trapezoid" || profile.params.accelMs + profile.params.decelMs <= durationMs;
  });

/**
 * 整体缩放：选区起点不动，每个选中物体从它选中的第一个块到最后一个块之间的块（选没选中都算）
 * 的时刻按同一倍数伸缩，各台之间的先后和错峰跟着等比；区内各段的变速时间同比例缩放、
 * 手填的经过速度按反比，曲线形状不变。这个物体区后面的块平移伸缩的长度，后面的区间时长不变。
 * shiftAll 时没选中的物体在选区之后的块和标记也平移，区内的标记一起伸缩。
 * 放不下（变速时间不够、碰到前一个块、同一时刻两个块）时整体不改，返回是哪台、哪个时刻。
 */
export const scaleTimelineBlocks = (
  sequence: ActionSequenceConfig,
  request: ScaleBlocksRequest,
  options?: SequenceEditOptions,
): ScaleBlocksResult => {
  const span = blocksSpanMs(sequence, request.blockIds);
  if (!span || span.endMs <= span.startMs) return { ok: false, reason: "nothing-to-scale" };
  const durationMs = snapTimeMs(request.durationMs);
  if (durationMs < TIME_STEP_MS) return { ok: false, reason: "invalid-time-range" };
  const oldDurationMs = span.endMs - span.startMs;
  if (durationMs === oldDurationMs) return { ok: true, sequence, factor: 1 };
  const factor = durationMs / oldDurationMs;
  const t0 = span.startMs;
  const scaleTime = (ms: number): number => snapTimeMs(t0 + (ms - t0) * factor);

  let resolved: ReturnType<typeof resolveActionSequence>;
  try {
    resolved = resolveActionSequence(sequence);
  } catch {
    return { ok: false, reason: "invalid-preset" };
  }

  const ids = new Set(request.blockIds);
  const regions = new Map<number, { startMs: number; endMs: number }>();
  for (const block of sequence.blocks) {
    if (!ids.has(block.id)) continue;
    for (const objectId of blockObjectIds(block)) {
      const region = regions.get(objectId);
      if (!region) {
        regions.set(objectId, { startMs: blockTimeMs(block), endMs: blockEndMs(block) });
        continue;
      }
      region.startMs = Math.min(region.startMs, blockTimeMs(block));
      region.endMs = Math.max(region.endMs, blockEndMs(block));
    }
  }
  const globalDeltaMs = scaleTime(span.endMs) - span.endMs;

  const placementOf = (block: TimelineBlock, objectId: number): ScalePlacement => {
    const startMs = blockTimeMs(block);
    const endMs = blockEndMs(block);
    const region = regions.get(objectId);
    if (!region) {
      return request.shiftAll && startMs >= span.endMs && globalDeltaMs !== 0
        ? { kind: "shift", deltaMs: globalDeltaMs }
        : { kind: "keep" };
    }
    if (startMs >= region.startMs && endMs <= region.endMs) return { kind: "scale" };
    if (startMs >= region.endMs) return { kind: "shift", deltaMs: scaleTime(region.endMs) - region.endMs };
    if (endMs <= region.startMs) return { kind: "keep" };
    return { kind: "straddle" };
  };

  // 每个物体：动了的块不能碰到（或越过）没动的前一个块；同一时刻不能有两个点块
  const keptEndByObject = new Map<number, number>();
  const movedStartByObject = new Map<number, { originMs: number; nextMs: number }>();
  // 物体 → 时刻 → 这个时刻有没有动过的点块
  const pointTimesByObject = new Map<number, Map<number, boolean>>();
  const scaledBlockIds = new Set<string>();
  const next = cloneSequence(sequence);
  for (let index = 0; index < next.blocks.length; index += 1) {
    const block = next.blocks[index]!;
    const objectIds = blockObjectIds(block);
    const placements = objectIds.map((objectId) => placementOf(block, objectId));
    const straddle = placements.findIndex((placement) => placement.kind === "straddle");
    if (straddle >= 0) {
      return { ok: false, reason: "crosses-previous", objectId: objectIds[straddle], atMs: blockTimeMs(block) };
    }
    const [placement] = placements;
    if (!placement) continue;
    if (placements.some((item) => !samePlacement(item, placement))) {
      return { ok: false, reason: "shared-block", atMs: blockTimeMs(block) };
    }
    let moved: TimelineBlock = block;
    if (placement.kind === "scale") {
      scaledBlockIds.add(block.id);
      const region = regions.get(objectIds[0]!)!;
      if (block.kind === "dynamic-preset") {
        moved = {
          ...block,
          startMs: scaleTime(block.startMs),
          endMs: scaleTime(block.endMs),
          profiles: scaleAxisProfiles(block.profiles, factor),
        };
      } else if (block.kind === "pose") {
        // 区内的位姿两边都在伸缩：手填的经过速度按反比；区两头的一边不动，保持原样
        const inner = block.atMs > region.startMs && block.atMs < region.endMs;
        const passSpeeds =
          inner && block.passSpeeds
            ? Object.fromEntries(
                Object.entries(block.passSpeeds).map(([axis, speed]) => [
                  axis,
                  typeof speed === "number" ? roundProjectCoordinate(speed / factor) : speed,
                ]),
              )
            : block.passSpeeds;
        moved = { ...block, atMs: scaleTime(block.atMs), ...(passSpeeds ? { passSpeeds } : {}) };
      } else {
        moved = { ...block, atMs: scaleTime(block.atMs) };
      }
    } else if (placement.kind === "shift") {
      moved = snapBlockTimes(shiftBlock(block, placement.deltaMs));
    }
    next.blocks[index] = moved;
    for (const objectId of objectIds) {
      if (placement.kind === "keep") {
        keptEndByObject.set(objectId, Math.max(keptEndByObject.get(objectId) ?? -1, blockEndMs(block)));
      } else {
        const current = movedStartByObject.get(objectId);
        if (!current || blockTimeMs(block) < current.originMs) {
          movedStartByObject.set(objectId, { originMs: blockTimeMs(block), nextMs: blockTimeMs(moved) });
        }
      }
      if (moved.kind !== "dynamic-preset") {
        const times = pointTimesByObject.get(objectId) ?? new Map<number, boolean>();
        const movedHere = placement.kind !== "keep";
        const existing = times.get(moved.atMs);
        // 原本就重复的老数据不拦，只拦这次挪出来的重复
        if (existing !== undefined && (existing || movedHere)) {
          return { ok: false, reason: "time-conflict", objectId, atMs: moved.atMs };
        }
        times.set(moved.atMs, movedHere);
        pointTimesByObject.set(objectId, times);
      }
    }
  }
  for (const [objectId, { originMs, nextMs }] of movedStartByObject) {
    const keptEndMs = keptEndByObject.get(objectId);
    if (keptEndMs === undefined) continue;
    if (nextMs < keptEndMs || (nextMs === keptEndMs && originMs !== keptEndMs)) {
      return { ok: false, reason: "crosses-previous", objectId, atMs: nextMs };
    }
  }
  if (next.blocks.some((block) => timeRangeError(block))) return { ok: false, reason: "invalid-time-range" };

  // 两头都在伸缩的区间：变速时间同比例缩放
  const pointByRef = new Map(resolved.poses.map((point) => [point.sourceRef, point]));
  const isScaledPoint = (ref: string): boolean => {
    const blockId = pointByRef.get(ref)?.sourceBlockId;
    return blockId != null && scaledBlockIds.has(blockId);
  };
  next.segments = next.segments.map((config) =>
    isScaledPoint(config.fromRef) && isScaledPoint(config.toRef)
      ? { ...config, settings: { profiles: scaleAxisProfiles(config.settings.profiles, factor) } }
      : config,
  );

  if (request.shiftAll && next.markers) {
    next.markers = next.markers.map((marker) => {
      if (marker.atMs >= span.endMs) return { ...marker, atMs: marker.atMs + globalDeltaMs };
      if (marker.atMs > t0) return { ...marker, atMs: scaleTime(marker.atMs) };
      return marker;
    });
  }

  // 时长变了的区间要放得下加减速
  let nextResolved: ReturnType<typeof resolveActionSequence>;
  try {
    nextResolved = resolveActionSequence(next);
  } catch {
    return { ok: false, reason: "invalid-preset" };
  }
  const nextPointByRef = new Map(nextResolved.poses.map((point) => [point.sourceRef, point]));
  for (const config of next.segments) {
    const from = nextPointByRef.get(config.fromRef);
    const to = nextPointByRef.get(config.toRef);
    const oldFrom = pointByRef.get(config.fromRef);
    const oldTo = pointByRef.get(config.toRef);
    if (!from || !to || !oldFrom || !oldTo) continue;
    const nextDurationMs = to.atMs - from.atMs;
    if (nextDurationMs === oldTo.atMs - oldFrom.atMs) continue;
    if (!profilesFit(config.settings.profiles, nextDurationMs)) {
      return { ok: false, reason: "phase-too-short", objectId: from.objectId, atMs: from.atMs };
    }
  }

  const committed = commitBlocks(sequence, next, options);
  if (!committed.ok) return committed;
  return { ok: true, sequence: committed.sequence, factor };
};

/**
 * 改一个位姿某轴的经过速度规则：mode 为跟前段 / 跟后段，null 改回自动（手填的也去掉）。
 * 带 profileWrite 时同一步把那段曲线也换掉（比如变速时间从「不变速」改回一个时长）
 */
export const setPassSpeedMode = (
  sequence: ActionSequenceConfig,
  blockId: string,
  axis: VirtualAxisId,
  mode: PassSpeedMode | null,
  profileWrite?: SegmentProfileWrite,
): EditResult => {
  const index = sequence.blocks.findIndex((block) => block.id === blockId);
  const block = sequence.blocks[index];
  if (block?.kind !== "pose") return { ok: false, reason: "missing-block" };
  const { passSpeeds, passSpeedModes, ...rest } = block;
  const speeds = { ...passSpeeds };
  delete speeds[axis];
  const modes = { ...passSpeedModes };
  if (mode === null) delete modes[axis];
  else modes[axis] = mode;
  const next = cloneSequence(sequence);
  next.blocks[index] = {
    ...rest,
    ...(Object.keys(speeds).length > 0 ? { passSpeeds: speeds } : {}),
    ...(Object.keys(modes).length > 0 ? { passSpeedModes: modes } : {}),
  };
  return { ok: true, sequence: profileWrite ? writeSegmentProfiles(next, [profileWrite]) : finalize(next) };
};

export type SpeedPointRefusal =
  /** 游标不在这段中间 */
  | "outside-segment"
  /** 游标在某根轴的加减速里（离变速至少要留 0.1 s） */
  | "not-in-cruise"
  | SequenceEditError;

export type SpeedPointResult =
  | { ok: true; sequence: ActionSequenceConfig; blockId: string }
  | { ok: false; reason: SpeedPointRefusal; axis?: VirtualAxisId };

/**
 * 在游标处插入变速点：按现在的曲线把这段从 atMs 切开，新位姿的值取这一刻曲线上的位置，
 * 在动的轴经过速度「跟前段」（前半段末尾不变速、后半段从这个速度接着走），曲线和原来一样。
 * 前半段变速时间沿用原来的加速，后半段沿用原来的减速；两端原来自动算的经过速度定成现在的值，
 * 切开后不跟着变。atMs 要在每根在动的轴的匀速段里（离加减速至少 0.1 s）。
 */
export const insertSpeedPoint = (
  sequence: ActionSequenceConfig,
  segmentKey: string,
  atMs: number,
  options?: SequenceEditOptions,
): SpeedPointResult => {
  let resolved: ReturnType<typeof resolveActionSequence>;
  try {
    resolved = resolveActionSequence(sequence);
  } catch {
    return { ok: false, reason: "invalid-preset" };
  }
  const segment = resolved.segments.find((item) => item.key === segmentKey);
  if (!segment || !segment.configurable) return { ok: false, reason: "missing-block" };
  const splitMs = snapTimeMs(atMs);
  if (!(splitMs > segment.startMs && splitMs < segment.endMs)) return { ok: false, reason: "outside-segment" };

  const config = sequence.segments.find((item) => item.fromRef === segment.fromRef && item.toRef === segment.toRef);
  const baseProfiles = config?.settings.profiles ?? createDefaultAxisProfiles(segment.durationMs);
  const firstMs = splitMs - segment.startMs;
  const secondMs = segment.endMs - splitMs;
  const uncontrolled = uncontrolledAxesOf(resolved, segment.objectId);
  const pose: KeyframePose = {};
  const passSpeedModes: Partial<Record<VirtualAxisId, PassSpeedMode>> = {};
  const firstProfiles = cloneAxisProfiles(baseProfiles);
  const secondProfiles = cloneAxisProfiles(baseProfiles);
  // 两端原来自动算的经过速度：切开后前后段的平均速度变了，先定住，曲线才不变
  const pinned = new Map<string, Partial<Record<VirtualAxisId, number>>>();
  const pin = (ref: string, axis: VirtualAxisId) => {
    const point = resolved.poses.find((item) => item.sourceRef === ref);
    const junction = point?.junctions?.[axis];
    if (!point?.sourceBlockId || point.sourceKind !== "pose" || junction?.kind !== "auto") return;
    pinned.set(point.sourceBlockId, { ...pinned.get(point.sourceBlockId), [axis]: roundProjectCoordinate(junction.speed) });
  };

  for (const axis of ALL_VIRTUAL_AXES) {
    if (uncontrolled.includes(axis)) continue;
    const motion = segmentAxisMotion(segment, axis);
    // 这一根在端点上经过、整段曲线更长：新位姿也不设定它，曲线不动
    if (isPassThroughMotion(segment, motion)) continue;
    const value = axisMotionValueAt(motion, splitMs);
    pose[axis] = roundProjectCoordinate(value);
    const profile = baseProfiles[axis];
    if (motion.to === motion.from || profile.kind !== "trapezoid") continue;
    const shape = axisMotionShape(motion);
    const accelMs = profile.params.accelMs;
    const decelMs = profile.params.decelMs;
    if (!shape || firstMs < accelMs + TIME_STEP_MS || secondMs < decelMs + TIME_STEP_MS) {
      return { ok: false, reason: "not-in-cruise", axis };
    }
    firstProfiles[axis] = {
      kind: "trapezoid",
      params: { accelMs, decelMs: Math.max(TIME_STEP_MS, Math.min(decelMs, snapTimeMs(firstMs - accelMs))) },
    };
    secondProfiles[axis] = {
      kind: "trapezoid",
      params: { accelMs: Math.max(TIME_STEP_MS, Math.min(accelMs, snapTimeMs(secondMs - decelMs))), decelMs },
    };
    passSpeedModes[axis] = "prev";
    pin(segment.fromRef, axis);
    pin(segment.toRef, axis);
  }
  if (Object.keys(pose).length === 0) return { ok: false, reason: "not-in-cruise" };

  const next = cloneSequence(sequence);
  const blockId = nextBlockId(new Set(sequence.blocks.map((block) => block.id)));
  next.blocks = next.blocks.map((block) => {
    const speeds = pinned.get(block.id);
    if (!speeds || block.kind !== "pose") return block;
    return { ...block, passSpeeds: { ...block.passSpeeds, ...speeds } };
  });
  next.blocks.push({
    id: blockId,
    kind: "pose",
    objectId: segment.objectId,
    atMs: splitMs,
    pose,
    ...(Object.keys(passSpeedModes).length > 0 ? { passSpeedModes } : {}),
  });
  next.segments = [
    ...next.segments.filter((item) => !(item.fromRef === segment.fromRef && item.toRef === segment.toRef)),
    { fromRef: segment.fromRef, toRef: blockId, settings: { profiles: firstProfiles } },
    { fromRef: blockId, toRef: segment.toRef, settings: { profiles: secondProfiles } },
  ];
  const committed = commitBlocks(sequence, next, options);
  if (!committed.ok) return committed;
  return { ok: true, sequence: committed.sequence, blockId };
};

/**
 * 展开引用：引用块换成被引用序列里的块（id 带着引用块的前缀，区间设置照搬），动作和展开前一样，
 * 之后就是普通块，和源序列不再关联。首尾那两帧的「停」留着（经过速度手填 0），要接着走就改成自动。
 */
export const explodeSequenceRefs = (
  sequence: ActionSequenceConfig,
  blockIds: readonly string[],
  options?: SequenceEditOptions,
): EditResult => {
  const ids = new Set(blockIds);
  const refs = sequence.blocks.filter((block) => ids.has(block.id) && block.kind === "sequence-ref");
  if (refs.length === 0) return { ok: false, reason: "missing-block" };
  const next = cloneSequence(sequence);
  next.blocks = next.blocks.filter((block) => !refs.some((ref) => ref.id === block.id));
  for (const ref of refs) {
    let expanded: ActionSequenceConfig;
    try {
      expanded = expandSequenceRefs({ ...sequence, blocks: [ref], segments: [] }).sequence;
    } catch {
      return { ok: false, reason: "invalid-preset" };
    }
    next.blocks.push(...expanded.blocks);
    next.segments.push(...expanded.segments);
  }
  return commitBlocks(sequence, next, options);
};

export type SequenceRefInsertRefusal =
  /** 游标正好在某个动态预设或引用中间，不能从中间插 */
  | "straddles-block"
  /** 被引用的序列是空的 */
  | "empty-source"
  | SequenceEditError;

export type SequenceRefInsertResult =
  | {
      ok: true;
      sequence: ActionSequenceConfig;
      blockId: string;
      /** 引用前面加的过渡有多长（不用过渡时为 0） */
      transitionMs: number;
      /** 游标后面的块和标记往后挪了多少（后面没东西时为 0） */
      shiftedMs: number;
    }
  | { ok: false; reason: SequenceRefInsertRefusal; atMs?: number };

/**
 * 在 atMs 引用另一条序列：
 * - 引用里的物体在 atMs 的位置和它开头不一样时，先加一段过渡（同时到达、最慢那台走最快），
 *   过渡从 atMs 开始（那一刻没有位姿的加一帧当前位置），引用接在过渡后面；
 * - atMs 后面（不含 atMs）所有物体的块和标记往后挪「过渡 + 引用时长」，给它让出位置。
 * 游标在某个动态预设或引用中间时不插。
 */
export const insertSequenceRef = (
  sequence: ActionSequenceConfig,
  request: {
    source: ActionSequenceConfig;
    atMs: number;
    objectOf: (objectId: number) => ControlledObject | undefined;
  },
  options?: SequenceEditOptions,
): SequenceRefInsertResult => {
  const atMs = snapTimeMs(request.atMs);
  const existingIds = new Set(sequence.blocks.map((block) => block.id));
  let ref: Extract<TimelineBlock, { kind: "sequence-ref" }>;
  let contentStart: Map<number, KeyframePose>;
  try {
    ref = buildSequenceRefBlock(request.source, { id: nextBlockId(existingIds), atMs });
    contentStart = sequenceShape(resolveActionSequence(refContentAsSequence(ref.content)), "start");
  } catch {
    return { ok: false, reason: "invalid-preset" };
  }
  if (ref.orderedObjectIds.length === 0 || ref.content.blocks.length === 0) {
    return { ok: false, reason: "empty-source" };
  }
  const straddling = sequence.blocks.find((block) => blockTimeMs(block) < atMs && atMs < blockEndMs(block));
  if (straddling) return { ok: false, reason: "straddles-block", atMs: blockTimeMs(straddling) };

  let resolved: ReturnType<typeof resolveActionSequence>;
  try {
    resolved = resolveActionSequence(sequence);
  } catch {
    return { ok: false, reason: "invalid-preset" };
  }
  // 引用里的物体在 atMs 的位置（atMs 前已经在序列里出现过的才算；没出现过的直接从引用开头起步）
  const here = evaluateResolvedSequence(resolved, atMs);
  const from = new Map<number, KeyframePose>();
  for (const objectId of ref.orderedObjectIds) {
    const points = resolved.posesByObject.get(objectId);
    const pose = here.get(objectId);
    if (!points || !pose || (points[0]?.atMs ?? Infinity) > atMs) continue;
    const uncontrolled = uncontrolledAxesOf(resolved, objectId);
    const controlled: KeyframePose = {};
    for (const axis of ALL_VIRTUAL_AXES) {
      if (!uncontrolled.includes(axis)) controlled[axis] = roundProjectCoordinate(pose[axis]);
    }
    from.set(objectId, controlled);
  }
  const plan = planShapeTransition({ from, to: contentStart, objectOf: request.objectOf, timing: "sync" });
  const moving = plan.objects.filter((object) => object.durationMs > 0);
  const pointAt = (objectId: number) =>
    resolved.posesByObject.get(objectId)?.some((point) => point.atMs === atMs) ?? false;
  // 不用动、但 atMs 那一刻已有关键点的物体：引用往后挪一档，免得同一时刻两个关键点
  const transitionMs =
    moving.length > 0 ? plan.totalMs : ref.orderedObjectIds.some(pointAt) ? TIME_STEP_MS : 0;
  const shiftMs = transitionMs + ref.durationMs;

  const next = cloneSequence(sequence);
  const later = next.blocks.some((block) => blockTimeMs(block) > atMs) ||
    (next.markers ?? []).some((marker) => marker.atMs > atMs);
  if (later) {
    next.blocks = next.blocks.map((block) =>
      blockTimeMs(block) > atMs ? snapBlockTimes(shiftBlock(block, shiftMs)) : block,
    );
    if (next.markers) {
      next.markers = next.markers.map((marker) =>
        marker.atMs > atMs ? { ...marker, atMs: marker.atMs + shiftMs } : marker,
      );
    }
  }
  // 过渡从 atMs 开始：那一刻没有关键点的物体加一帧当前位置
  for (const object of moving) {
    if (pointAt(object.objectId)) continue;
    const id = nextBlockId(existingIds);
    existingIds.add(id);
    next.blocks.push({ id, kind: "pose", objectId: object.objectId, atMs, pose: { ...from.get(object.objectId) } });
  }
  ref = { ...ref, atMs: atMs + transitionMs };
  next.blocks.push(ref);
  const committed = commitBlocks(sequence, next, options);
  if (!committed.ok) return committed;

  // 过渡那一段用算好的曲线
  let withProfiles = committed.sequence;
  if (moving.length > 0) {
    try {
      const after = resolveActionSequence(committed.sequence);
      const writes: SegmentProfileWrite[] = [];
      for (const object of moving) {
        const segment = after.segments.find(
          (item) =>
            item.objectId === object.objectId &&
            item.configurable &&
            item.startMs === atMs &&
            item.endMs === atMs + transitionMs,
        );
        if (!segment) continue;
        for (const [axis, profile] of Object.entries(object.profiles)) {
          writes.push({
            fromRef: segment.fromRef,
            toRef: segment.toRef,
            axis: axis as VirtualAxisId,
            profile,
            durationMs: segment.durationMs,
          });
        }
      }
      withProfiles = writeSegmentProfiles(committed.sequence, writes);
    } catch {
      withProfiles = committed.sequence;
    }
  }
  return {
    ok: true,
    sequence: withProfiles,
    blockId: ref.id,
    transitionMs,
    shiftedMs: later ? shiftMs : 0,
  };
};
