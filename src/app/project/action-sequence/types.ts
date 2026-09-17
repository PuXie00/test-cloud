import type { TrajectoryMode } from "@shared/action-sequence";

export type { TrajectoryMode } from "@shared/action-sequence";

export type ModelPose = { v1: number; v2: number; v3: number };

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
  pose: ModelPose;
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
  blocks: TimelineBlock[];
  segments: MotionSegmentConfig[];
};
