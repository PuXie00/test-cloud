import type { VirtualAxisValues } from "../types";

/** 动作页 3D 轨迹显示：选中的物体 / 序列里全部物体 / 不显示 */
export type MotionPathMode = "selected" | "all" | "off";

export const MOTION_PATH_MODE_STORAGE_KEY = "yz.console.motionPathMode";
export const DEFAULT_MOTION_PATH_MODE: MotionPathMode = "selected";

export const parseMotionPathMode = (raw: unknown): MotionPathMode =>
  raw === "all" || raw === "off" ? raw : DEFAULT_MOTION_PATH_MODE;

export const readStoredMotionPathMode = (): MotionPathMode => {
  try {
    return parseMotionPathMode(localStorage.getItem(MOTION_PATH_MODE_STORAGE_KEY));
  } catch {
    return DEFAULT_MOTION_PATH_MODE;
  }
};

export const writeStoredMotionPathMode = (mode: MotionPathMode): void => {
  try {
    localStorage.setItem(MOTION_PATH_MODE_STORAGE_KEY, mode);
  } catch {
    // 隐私模式、配额满时不记
  }
};

export type MotionPathSample = { atMs: number; values: VirtualAxisValues };

/** 一个关键点：位姿，或预设 / 引用展开出来的点 */
export type MotionPathKeyframe = MotionPathSample & {
  /** 点它选中的块（位姿块，或生成它的预设 / 引用块） */
  blockId: string | null;
  selected: boolean;
  /** 这个块有校验错误 */
  invalid: boolean;
};

/** 有校验错误的一段（运动区间的起止时刻） */
export type MotionPathIssueSpan = { fromMs: number; toMs: number; segmentKey: string };

/** 一台物体在 3D 里要画的整条动作 */
export type MotionPathEntry = {
  /** 引擎里的物体 id */
  objectId: string;
  /** 选中的物体：画得显眼，轨迹线能点；其余（「全部」时）画得淡，只能点位姿点 */
  selected: boolean;
  /** 按时间取样的姿态（含起止）；为空时只画轮廓 */
  samples: MotionPathSample[];
  keyframes: MotionPathKeyframe[];
  /** 游标处的姿态：轨迹上的亮点 */
  cursor: MotionPathSample | null;
  issues: MotionPathIssueSpan[];
  /** 上一个、下一个位姿的样子（线框） */
  prev?: MotionPathSample | null;
  next?: MotionPathSample | null;
  /** 游标这一刻在有问题的那段里：物体标红 */
  issueAtCursor?: boolean;
};

/** 3D 里点了轨迹：位姿点（选中那个块），或轨迹线上的某一刻（有问题的那段带区间 key） */
export type MotionPathPickEvent =
  | { kind: "keyframe"; objectId: string; blockId: string; atMs: number }
  | { kind: "time"; objectId: string; atMs: number; segmentKey: string | null };
