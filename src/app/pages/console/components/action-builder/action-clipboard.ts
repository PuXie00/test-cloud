import { useSyncExternalStore } from "react";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { SEQUENCE_NAME_MAX_LENGTH, normalizeSequenceName } from "@/app/project/action-sequence/sequence-name";
import {
  finalizeSequenceSegments,
  remapTimelineClipboard,
  type ObjectIdMap,
  type SequenceEditOptions,
  type TimelineClipboard,
} from "./sequence-ops";

/** 复制时记下的物体信息，粘贴到别的工程时靠它找对应物体 */
export type ClipboardObject = {
  id: number;
  name: string;
  /** 工程文件里的控制类型编码 */
  controlType: number;
};

export type SequenceClipboard = {
  projectId: string | null;
  sequence: ActionSequenceConfig;
  objects: ClipboardObject[];
};

export type BlocksClipboard = TimelineClipboard & {
  projectId: string | null;
  /** 块用到的物体，按时间轴轨道顺序 */
  objects: ClipboardObject[];
};

type ClipboardState = {
  sequence: SequenceClipboard | null;
  blocks: BlocksClipboard | null;
};

const STORAGE_KEY = "ics.action-clipboard";

const loadState = (): ClipboardState => {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return { sequence: null, blocks: null };
    const parsed = JSON.parse(raw) as Partial<ClipboardState>;
    return { sequence: parsed.sequence ?? null, blocks: parsed.blocks ?? null };
  } catch {
    return { sequence: null, blocks: null };
  }
};

let state: ClipboardState = loadState();
const listeners = new Set<() => void>();

const setState = (next: ClipboardState) => {
  state = next;
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存不下也不影响本次会话内的复制粘贴
  }
  for (const listener of listeners) listener();
};

/**
 * 动作的剪贴板：放在模块里而不是某个工程的状态里，切换工程后仍能粘贴；
 * 同时存一份到 sessionStorage，页面刷新后也还在。序列和块各有一格，互不覆盖。
 */
export const actionClipboard = {
  get: (): ClipboardState => state,
  setSequence: (sequence: SequenceClipboard) =>
    setState({ ...state, sequence: structuredClone(sequence) }),
  setBlocks: (blocks: BlocksClipboard) => setState({ ...state, blocks: structuredClone(blocks) }),
  clear: () => setState({ sequence: null, blocks: null }),
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const useActionClipboard = (): ClipboardState =>
  useSyncExternalStore(actionClipboard.subscribe, actionClipboard.get, actionClipboard.get);

/**
 * 给复制来的物体找当前工程里的对应物体：
 * 先找 id 相同且控制类型相同的；没有再找名称相同、控制类型相同且唯一的。找不到的不映射。
 */
export const matchClipboardObjects = (
  sources: readonly ClipboardObject[],
  targets: readonly ClipboardObject[],
): Map<number, number> => {
  const matched = new Map<number, number>();
  const used = new Set<number>();
  const claim = (source: ClipboardObject, target: ClipboardObject | undefined) => {
    if (!target || used.has(target.id)) return;
    matched.set(source.id, target.id);
    used.add(target.id);
  };
  for (const source of sources) {
    claim(
      source,
      targets.find((target) => target.id === source.id && target.controlType === source.controlType),
    );
  }
  for (const source of sources) {
    if (matched.has(source.id)) continue;
    const sameName = targets.filter(
      (target) =>
        target.name === source.name &&
        target.controlType === source.controlType &&
        !used.has(target.id),
    );
    if (sameName.length === 1) claim(source, sameName[0]);
  }
  return matched;
};

export type RetargetResult =
  | { ok: true; maps: ObjectIdMap[] }
  | { ok: false; message: string };

/**
 * 粘贴到选中的物体上：
 * 复制的块只涉及一个物体时，每个选中的物体各粘贴一份；
 * 涉及多个物体时，要选中同样数量的物体，按时间轴轨道顺序一一对应。
 */
export const retargetToSelectedObjects = (
  sources: readonly ClipboardObject[],
  targetIds: readonly number[],
): RetargetResult => {
  if (sources.length === 0 || targetIds.length === 0) return { ok: true, maps: [] };
  const [only] = sources;
  if (sources.length === 1 && only) {
    return { ok: true, maps: targetIds.map((targetId) => new Map([[only.id, targetId]])) };
  }
  if (targetIds.length !== sources.length) {
    return {
      ok: false,
      message: `复制的动作涉及 ${sources.length} 个物体，请选中 ${sources.length} 个物体再粘贴`,
    };
  }
  return {
    ok: true,
    maps: [new Map(sources.map((source, index) => [source.id, targetIds[index]!]))],
  };
};

const codePoints = (value: string): string[] => [...value];

/** 粘贴的序列名：不重名就沿用原名，重名追加「 (2)」「 (3)」…，总长不超过序列名上限 */
export const nextPastedSequenceName = (name: string, existingNames: readonly string[]): string => {
  const taken = new Set(existingNames.map(normalizeSequenceName));
  const base = normalizeSequenceName(name);
  if (base && !taken.has(base) && codePoints(base).length <= SEQUENCE_NAME_MAX_LENGTH) return base;
  for (let index = 2; index < 1000; index += 1) {
    const suffix = ` (${index})`;
    const room = SEQUENCE_NAME_MAX_LENGTH - codePoints(suffix).length;
    if (room <= 0) break;
    const candidate = `${codePoints(base).slice(0, room).join("").trimEnd()}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return codePoints(base).slice(0, SEQUENCE_NAME_MAX_LENGTH).join("");
};

export type PastedSequence = {
  sequence: ActionSequenceConfig;
  /** 物体对应不上而没粘贴的块数 */
  droppedBlocks: number;
  /** 在当前工程里找不到对应的物体名 */
  unmatchedObjectNames: string[];
};

/** 把复制的序列做成当前工程里的一条新序列：新 id、不重名，物体按 matchClipboardObjects 对应 */
export const buildPastedSequence = (
  clipboard: SequenceClipboard,
  target: { id: number; existingNames: readonly string[]; objects: readonly ClipboardObject[] },
  options?: SequenceEditOptions,
): PastedSequence => {
  const objectMap = matchClipboardObjects(clipboard.objects, target.objects);
  const remapped = remapTimelineClipboard(
    { blocks: clipboard.sequence.blocks, segments: clipboard.sequence.segments },
    objectMap,
    (blockId) => blockId,
  );
  const sequence = finalizeSequenceSegments(
    {
      ...structuredClone(clipboard.sequence),
      id: target.id,
      name: nextPastedSequenceName(clipboard.sequence.name, target.existingNames),
      blocks: remapped.clipboard.blocks,
      segments: remapped.clipboard.segments,
    },
    options,
  );
  return {
    sequence,
    droppedBlocks: remapped.droppedBlocks,
    unmatchedObjectNames: clipboard.objects
      .filter((object) => !objectMap.has(object.id))
      .map((object) => object.name),
  };
};
