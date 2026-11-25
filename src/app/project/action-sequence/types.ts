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

/**
 * 经过速度跟着哪一段走：prev 跟前段（等于进来那段的匀速，那段末尾不变速，常用于加加速），
 * next 跟后段（等于出去那段的匀速，那段开头不变速，常用于减减速）。
 * 存的是规则不是数值：前后段改了时长、行程，经过速度跟着重算；下发 PLC 的仍是算好的数值。
 */
export type PassSpeedMode = "prev" | "next";

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
  /** 按规则算的经过速度（跟前段 / 跟后段）；和 passSpeeds 同一轴都有时以它为准 */
  passSpeedModes?: Partial<Record<"v1" | "v2" | "v3", PassSpeedMode>>;
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

/** 引用块里存的被引用序列内容：保存时的名字和块、区间设置（不含 id、标记） */
export type SequenceRefContent = {
  name: string;
  trajectoryMode: TrajectoryMode;
  blocks: TimelineBlock[];
  segments: MotionSegmentConfig[];
};

/**
 * 引用另一条动作序列：从 atMs 起按它走，解析时像预设一样展开成关键点，里面的块不能单独改。
 * content 是被引用序列已保存的内容：源序列保存后各处引用跟着更新；源序列删了引用照样能用，也能展开成普通块。
 * 首尾的位姿在这里停住（和单独播放这条序列一样从静止开始、到静止结束）。
 */
export type SequenceRefBlock = {
  id: string;
  kind: "sequence-ref";
  /** 被引用的动作序列 id */
  sequenceId: number;
  atMs: number;
  /** content 的总时长：时间轴上画多长，和后面的块会不会重叠 */
  durationMs: number;
  /** content 里动到的物体：时间轴上在哪几行 */
  orderedObjectIds: number[];
  content: SequenceRefContent;
  label?: string;
};

export type TimelineBlock =
  | PoseBlock
  | InstructionBlock
  | StaticPresetBlock
  | DynamicPresetBlock
  | SequenceRefBlock;

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
