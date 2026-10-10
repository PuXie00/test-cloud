import type {
  ControlType,
  ProgramItemRunOptions,
  VirtualAxisId,
} from "@/app/project/project-document-types";

export const VIRTUAL_AXIS_IDS: VirtualAxisId[] = ["v1", "v2", "v3"];

export const VIRTUAL_AXIS_META: Record<VirtualAxisId, { label: string; unit: string }> = {
  v1: { label: "升降/旋转", unit: "mm" },
  v2: { label: "摆动 X", unit: "°" },
  v3: { label: "摆动 Y/偏转", unit: "°" },
};

export type ControlledObject = {
  id: number;
  name: string;
  currentPosition: number;
  unit: string;
  axisLabel: string;
  enabled: boolean;
  enabledAxes?: VirtualAxisId[];
  rangeByAxis?: Partial<Record<VirtualAxisId, { min: number; max: number }>>;
  maxSpeedByAxis?: Partial<Record<VirtualAxisId, number>>;
  minAccelTimeByAxis?: Partial<Record<VirtualAxisId, number>>;
  controlType?: ControlType;
};

export type ProgramNode = {
  id: string;
  name: string;
  type?: "program" | "chapter" | "sequence";
  children?: ProgramNode[];
  /** sequence 节点：节目条目的推子槽运行选项，动作页改节目时原样带回 */
  runOptions?: ProgramItemRunOptions;
};

export const PIXELS_PER_SECOND = 16;
/**
 * 连续缩放：状态为 px/s（秒为单位）。
 * − 增大 px/s → 块变宽；+ 减小 px/s → 块变窄。
 * 刻度间隔由 computeNiceTimeTicks 自适应，不绑死档位。
 */
export const TIMELINE_PX_PER_SECOND_DEFAULT = 16;
export const TIMELINE_PX_PER_SECOND_MIN = 2;
export const TIMELINE_PX_PER_SECOND_MAX = 200;
export const TIMELINE_ZOOM_FACTOR = 1.25;

export const clampTimelinePxPerSecond = (value: number): number =>
  Math.min(
    TIMELINE_PX_PER_SECOND_MAX,
    Math.max(TIMELINE_PX_PER_SECOND_MIN, value),
  );

/** @deprecated 使用 timelinePxPerSecond；保留别名避免残留引用编译失败 */
export type TimelineZoom = number;

export const ACTION_BUILDER_SIDE_WIDTH = 188;
export const TRACK_LABEL_WIDTH = ACTION_BUILDER_SIDE_WIDTH;
/** 右列时间区左内边，保证 t=0 的游标/菱形/0 刻度完整可见 */
export const TIMELINE_PAD_LEFT = 8;
export const MIN_BLOCK_MS = 500;

export const TIME_STEP_MS = 100;

export const snapTimeMs = (ms: number): number =>
  Math.max(0, Math.round(ms / TIME_STEP_MS) * TIME_STEP_MS);

export const msToSeconds = (ms: number): number => ms / 1000;

export const secondsToMs = (seconds: number): number => snapTimeMs(seconds * 1000);

export const formatTime = (ms: number): string => msToSeconds(ms).toFixed(1);

export const msToPx = (ms: number, pxPerSecond: number = PIXELS_PER_SECOND): number =>
  (ms / 1000) * pxPerSecond;

export const pxToMs = (px: number, pxPerSecond: number = PIXELS_PER_SECOND): number =>
  Math.round((px / pxPerSecond) * 1000);

export const findControlledObjectById = (
  objects: ControlledObject[],
  id: number,
): ControlledObject | undefined => objects.find((object) => object.id === id);

export const countSequenceBlocks = (sequence: { blocks: readonly unknown[] }): number =>
  sequence.blocks.length;

/** 从节目树去掉对指定动作序列的引用，避免落盘时悬空 ref。 */
export const stripSequenceFromProgramTree = (
  programs: ProgramNode[],
  sequenceId: number,
): ProgramNode[] => {
  const dropId = String(sequenceId);
  const strip = (nodes: ProgramNode[]): ProgramNode[] => {
    let changed = false;
    const next: ProgramNode[] = [];
    for (const node of nodes) {
      if (node.type === "sequence" && node.id === dropId) {
        changed = true;
        continue;
      }
      if (!node.children || node.children.length === 0) {
        next.push(node);
        continue;
      }
      const children = strip(node.children);
      if (children === node.children) {
        next.push(node);
        continue;
      }
      changed = true;
      next.push({ ...node, children });
    }
    return changed ? next : nodes;
  };
  return strip(programs);
};

/** 节目树里引用该序列的节点改名，与动作序列库保持一致 */
export const renameSequenceInProgramTree = (
  programs: ProgramNode[],
  sequenceId: number,
  name: string,
): ProgramNode[] => {
  const targetId = String(sequenceId);
  const rename = (nodes: ProgramNode[]): ProgramNode[] => {
    let changed = false;
    const next = nodes.map((node) => {
      const children = node.children ? rename(node.children) : node.children;
      const renamed = node.type === "sequence" && node.id === targetId && node.name !== name;
      if (!renamed && children === node.children) return node;
      changed = true;
      return { ...node, ...(renamed ? { name } : {}), ...(children ? { children } : {}) };
    });
    return changed ? next : nodes;
  };
  return rename(programs);
};
