import type {
  VirtualAxisId,
  VirtualAxisValues,
} from "@/app/project/project-document-types";
import type { ResolvedActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import type {
  ActionSequenceConfig,
  ModelPose,
  MotionSegmentConfig,
  PresetParamValue,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import { MIN_BLOCK_MS, VIRTUAL_AXIS_IDS, type ControlledObject, type CueItem } from "./timeline/timeline-data";

export type TimelineObjectLookup = (objectId: number) => ControlledObject | undefined;

export const DEFAULT_BLOCK_MS = 3000;

export const nextId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const poseFromTarget = (target: VirtualAxisValues | undefined, fallbackV1 = 0): ModelPose => ({
  v1: target?.v1 ?? fallbackV1,
  v2: target?.v2 ?? 0,
  v3: target?.v3 ?? 0,
});

const previousResolvedPose = (
  resolved: ResolvedActionSequence,
  objectId: number,
  atMs: number,
): ModelPose | undefined => {
  const points = resolved.posesByObject.get(objectId) ?? [];
  let previous: ModelPose | undefined;
  for (const point of points) {
    if (point.atMs >= atMs) break;
    previous = point.pose;
  }
  return previous;
};

export const cueDropPoseForObject = (
  cue: CueItem,
  objectId: number,
  atMs: number,
  options: {
    resolved: ResolvedActionSequence;
    enabledAxes?: VirtualAxisId[];
  },
): ModelPose | null => {
  const target = cue.targets[String(objectId)];
  if (target === undefined) return null;
  const previous = previousResolvedPose(options.resolved, objectId, atMs);
  const pose: ModelPose = { v1: 0, v2: 0, v3: 0 };
  for (const axis of VIRTUAL_AXIS_IDS) {
    const enabled = options.enabledAxes === undefined || options.enabledAxes.includes(axis);
    const cueValue = target[axis];
    pose[axis] = enabled && cueValue !== undefined
      ? cueValue
      : previous?.[axis] ?? 0;
  }
  return pose;
};

export const collectTargets = (
  objectIds: number[],
  lookup?: TimelineObjectLookup,
): Record<string, VirtualAxisValues> => {
  const targets: Record<string, VirtualAxisValues> = {};
  objectIds.forEach((objectId) => {
    const object = lookup?.(objectId);
    if (!object) return;
    const values: VirtualAxisValues = { v1: object.currentPosition };
    for (const axis of object.enabledAxes ?? []) {
      if (values[axis] === undefined) values[axis] = 0;
    }
    targets[String(objectId)] = values;
  });
  return targets;
};

export const createCueItem = (
  objectIds: number[],
  name?: string,
  lookup?: TimelineObjectLookup,
): CueItem => ({
  id: nextId("cue"),
  name: name ?? "新建 Cue",
  targets: collectTargets(objectIds, lookup),
});

export const createEmptySequence = (name?: string): ActionSequenceConfig => ({
  id: nextId("seq"),
  name: name ?? "新建动作序列",
  trajectoryMode: "non-forced",
  blocks: [],
  segments: [],
});

/** 由两个姿态 Cue 组合生成过渡动作序列：起始位姿来自 from，到达位姿来自 to */
export const buildTransitionSequence = (
  from: CueItem,
  to: CueItem,
  durationMs: number,
  lookup?: TimelineObjectLookup,
): ActionSequenceConfig => {
  const objectIds = Object.keys(to.targets)
    .map(Number)
    .filter((id) => Number.isFinite(id) && from.targets[String(id)] !== undefined);
  const clampedMs = Math.max(durationMs, MIN_BLOCK_MS);
  const blocks: TimelineBlock[] = [];
  const segments: MotionSegmentConfig[] = [];
  for (const objectId of objectIds) {
    const key = String(objectId);
    const fromBlockId = nextId("blk");
    const toBlockId = nextId("blk");
    blocks.push(
      { id: fromBlockId, kind: "pose", objectId, atMs: 0, pose: poseFromTarget(from.targets[key]) },
      { id: toBlockId, kind: "pose", objectId, atMs: clampedMs, pose: poseFromTarget(to.targets[key]) },
    );
    segments.push({
      fromRef: fromBlockId,
      toRef: toBlockId,
      settings: {
        profiles: createDefaultAxisProfiles(
          clampedMs,
          lookup?.(objectId)?.minAccelTimeByAxis,
        ),
      },
    });
  }
  return {
    id: nextId("seq"),
    name: `${from.name} → ${to.name}`,
    trajectoryMode: "non-forced",
    blocks,
    segments,
  };
};

export const defaultPresetParams = (
  presetId: string,
  extras?: { amplitude?: number; phase?: number },
): Record<string, PresetParamValue> | null => {
  const amplitude = extras?.amplitude ?? 100;
  const phase = extras?.phase ?? 0;
  switch (presetId) {
    case "static-flat":
      return { v1: 0, v2: 0, v3: 0 };
    case "static-slope":
      return { baseV1: 0, stepV1: amplitude, v2: 0, v3: 0 };
    case "static-arc":
      return { baseV1: 0, amplitude, v2: 0, v3: 0 };
    case "static-wave":
      return { baseV1: 0, amplitude, phaseDeg: phase, intervalDeg: 90, v2: 0, v3: 0 };
    case "dynamic-level":
      return { startV1: 0, targetV1: amplitude, v2: 0, v3: 0 };
    case "dynamic-wave":
      return {
        baseV1: 0,
        amplitude,
        cycles: 1,
        direction: 1,
        intervalDeg: 90,
        sampleIntervalMs: 500,
        v2: 0,
        v3: 0,
      };
    default:
      return null;
  }
};
