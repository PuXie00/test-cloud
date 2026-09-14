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
  MotionSegmentSettings,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";

export type SequenceEditError =
  | "motion-overlap"
  | "missing-block"
  | "invalid-time-range"
  | "invalid-preset";

export type EditResult =
  | { ok: true; sequence: ActionSequenceConfig }
  | { ok: false; reason: SequenceEditError };

export type PasteResult =
  | { ok: true; sequence: ActionSequenceConfig; createdIds: string[] }
  | { ok: false; reason: SequenceEditError };

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

const commitBlocks = (
  sequence: ActionSequenceConfig,
  options?: SequenceEditOptions,
): EditResult => {
  if (hasMotionOverlap(sequence)) return { ok: false, reason: "motion-overlap" };
  return tryFinalize(sequence, options);
};

export const insertTimelineBlock = (
  sequence: ActionSequenceConfig,
  block: TimelineBlock,
  options?: SequenceEditOptions,
): EditResult => {
  const error = blockError(block);
  if (error) return { ok: false, reason: error };
  const next = cloneSequence(sequence);
  next.blocks.push(cloneBlock(block));
  return commitBlocks(next, options);
};

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
  const error = blockError(replacement);
  if (error) return { ok: false, reason: error };
  const next = cloneSequence(sequence);
  next.blocks[index] = cloneBlock(replacement);
  return commitBlocks(next, options);
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
  const moved = moveBlockTo(cloneBlock(current), atMs);
  if (timeRangeError(moved)) return sequence;
  const next = cloneSequence(sequence);
  next.blocks[index] = moved;
  const committed = commitBlocks(next, options);
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
    ids.has(block.id) ? shiftBlock(block, clampedDelta) : block,
  );
  const committed = commitBlocks(next, options);
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
  if (isInvalidTime(startMs) || isInvalidTime(endMs) || endMs <= startMs) {
    return { ok: false, reason: "invalid-time-range" };
  }
  const next = cloneSequence(sequence);
  const resized = next.blocks[index];
  if (resized === undefined || resized.kind !== "dynamic-preset") {
    return { ok: false, reason: "missing-block" };
  }
  resized.startMs = startMs;
  resized.endMs = endMs;
  return commitBlocks(next, options);
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

export const copyTimelineBlocks = (
  sequence: ActionSequenceConfig,
  blockIds: string[],
): TimelineBlock[] => {
  const ids = new Set(blockIds);
  return sequence.blocks.filter((block) => ids.has(block.id)).map(cloneBlock);
};

export const pasteTimelineBlocks = (
  sequence: ActionSequenceConfig,
  clipboard: TimelineBlock[],
  playheadMs: number,
  options?: SequenceEditOptions,
): PasteResult => {
  if (clipboard.length === 0) {
    return { ok: true, sequence: finalize(cloneSequence(sequence), options), createdIds: [] };
  }
  const originMs = Math.min(...clipboard.map(blockTimeMs));
  const deltaMs = playheadMs - originMs;
  const existingIds = new Set(sequence.blocks.map((block) => block.id));
  const createdIds: string[] = [];
  const next = cloneSequence(sequence);
  for (const source of clipboard) {
    const shifted = shiftBlock(cloneBlock(source), deltaMs);
    const error = blockError(shifted);
    if (error) return { ok: false, reason: error };
    const id = nextBlockId(existingIds);
    existingIds.add(id);
    createdIds.push(id);
    next.blocks.push({ ...shifted, id });
  }
  const committed = commitBlocks(next, options);
  if (!committed.ok) return committed;
  return { ok: true, sequence: committed.sequence, createdIds };
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
