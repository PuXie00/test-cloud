import type { TrajectoryMode } from "@shared/action-sequence";

export type { TrajectoryMode } from "@shared/action-sequence";

export type ModelPose = { v1: number; v2: number; v3: number };

/** 位姿块里的值。缺少的轴「不设定」：这一帧不停，按前后设定值之间的整段曲线经过。 */
export type KeyframePose = Partial<ModelPose>;

export type IdleAxisProfile = { kind: "idle" };

export type TrapezoidAxisProfile = {
  kind: "trapezoid";
  params: {
    accelMs: number;
    decelMs: number;
  };
};

export type MotionProfile = IdleAxisProfile | TrapezoidAxisProfile;

export type AxisMotionProfiles = {
  v1: MotionProfile;
  v2: MotionProfile;
  v3: MotionProfile;
};

export type PoseBlock = {
  id: string;
  kind: "pose";
  objectId: number;
  atMs: number;
  pose: KeyframePose;
  /**
   * 手填的经过速度（单位/秒，绝对值）：缺省时自动取前后两段平均速度的调和平均，0 表示停在这一帧。
   */
  passSpeeds?: Partial<Record<"v1" | "v2" | "v3", number>>;
  label?: string;
};

export type SetEnabledInstr = { enabled: boolean };

export type SetEnabledInstruction = {
  id: string;
  kind: "instruction";
  presetId: "set-enabled";
  objectId: number;
  atMs: number;
  instr: SetEnabledInstr;
  label?: string;
};

export type InstructionBlock = SetEnabledInstruction;

export type PresetParamValue = number | string | boolean;

/**
 * 按坐标排列：方向（水平面角度，0° 沿 X 正向、90° 沿 Z 正向）和每个参与物体沿这个方向的
 * 相对位置（与 orderedObjectIds 一一对应，第一个 0、最后一个 n−1，间距均匀时就是 0,1,2…）。
 * 只在应用预设和「按当前坐标重排」时更新。
 */
export type PresetLayout = {
  angleDeg: number;
  offsets: number[];
};

export type PresetBlockBase = {
  id: string;
  presetId: string;
  orderedObjectIds: number[];
  params: Record<string, PresetParamValue>;
  label?: string;
  /** 缺省时按选择顺序等距（老预设） */
  layout?: PresetLayout;
};

export type StaticPresetBlock = PresetBlockBase & {
  kind: "static-preset";
  atMs: number;
};

export type DynamicPresetBlock = PresetBlockBase & {
  kind: "dynamic-preset";
  startMs: number;
  endMs: number;
  profiles: AxisMotionProfiles;
};

export type TimelineBlock =
  | PoseBlock
  | InstructionBlock
  | StaticPresetBlock
  | DynamicPresetBlock;

export type MotionSegmentSettings = {
  profiles: AxisMotionProfiles;
};

export type MotionSegmentConfig = {
  fromRef: string;
  toRef: string;
  settings: MotionSegmentSettings;
};

/** 时间轴上带名字的标记，如「灯光切换」「演员入场」；只是标注，不下发设备 */
export type TimelineMarker = {
  id: string;
  atMs: number;
  name: string;
};

export type ActionSequenceConfig = {
  id: number;
  name: string;
  note?: string;
  trajectoryMode: TrajectoryMode;
  /** Closed-path repeat until stop. Missing/false = play once. */
  loop?: boolean;
  blocks: TimelineBlock[];
  segments: MotionSegmentConfig[];
  markers?: TimelineMarker[];
};
