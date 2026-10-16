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
   * 只对连续衔接的序列生效。
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
export type PresetBlockBase = {
  id: string;
  presetId: string;
  orderedObjectIds: number[];
  params: Record<string, PresetParamValue>;
  label?: string;
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

export type ActionSequenceConfig = {
  id: number;
  name: string;
  note?: string;
  trajectoryMode: TrajectoryMode;
  /** Closed-path repeat until stop. Missing/false = play once. */
  loop?: boolean;
  /** 连续衔接：中间位姿不减速到 0，只在起止、折返、停留处停。缺省（老序列）为每帧停 */
  continuousMotion?: boolean;
  blocks: TimelineBlock[];
  segments: MotionSegmentConfig[];
};
