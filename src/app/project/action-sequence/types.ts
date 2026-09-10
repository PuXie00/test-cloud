import type { TrajectoryMode } from "@shared/action-sequence";

export type { TrajectoryMode } from "@shared/action-sequence";

export type ModelPose = { v1: number; v2: number; v3: number };

export type TrapezoidAxisProfile = {
  kind: "trapezoid";
  params: {
    accelMs: number;
    decelMs: number;
  };
};

export type MotionProfile = TrapezoidAxisProfile;

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

export type SetEnabledBlock = {
  id: string;
  kind: "set-enabled";
  objectId: number;
  atMs: number;
  enabled: boolean;
  label?: string;
};

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
  | SetEnabledBlock
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
  id: string;
  name: string;
  note?: string;
  trajectoryMode: TrajectoryMode;
  blocks: TimelineBlock[];
  segments: MotionSegmentConfig[];
};
