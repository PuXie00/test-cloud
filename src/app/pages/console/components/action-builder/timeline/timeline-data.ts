import type {
  ControlType,
  VirtualAxisId,
  VirtualAxisValues,
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

/**
 * 姿态 Cue：只保存各物体的目标值，不保存执行时间 —
 * 到达时间取决于起始位置，由当前场景位置实时估算。
 */
export type CueItem = {
  id: string;
  name: string;
  /** 物体 → 各虚拟轴目标值（v1 升降/旋转 / v2 摆动X / v3 摆动Y或偏转） */
  targets: Record<string, VirtualAxisValues>;
  note?: string;
};

export const cueObjectIds = (cue: CueItem): string[] => Object.keys(cue.targets);

/** 两个 Cue 所存物体集合是否一致（组合过渡的前提） */
export const cueObjectSetsMatch = (a: CueItem, b: CueItem): boolean => {
  const idsA = cueObjectIds(a);
  const idsB = new Set(cueObjectIds(b));
  return idsA.length === idsB.size && idsA.every((id) => idsB.has(id));
};

export type ProgramNode = {
  id: string;
  name: string;
  type?: "program" | "chapter" | "cue" | "sequence";
  children?: ProgramNode[];
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

export const formatTime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

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
