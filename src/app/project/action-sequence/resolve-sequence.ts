import { cloneAxisProfiles, createDefaultAxisProfiles, syncAxisProfileToTravel } from "./motion-profile";
import { resolvePreset } from "./preset-registry";
import type {
  ActionSequenceConfig,
  DynamicPresetBlock,
  InstructionBlock,
  ModelPose,
  MotionSegmentConfig,
  MotionSegmentSettings,
} from "./types";

export type ResolvedPosePoint = {
  sourceRef: string;
  sourceBlockId: string | null;
  sourceKind: "pose" | "static-preset" | "dynamic-preset";
  objectId: number;
  atMs: number;
  pose: ModelPose;
  editable: boolean;
};

export type ResolvedMotionSegment = {
  key: string;
  objectId: number;
  fromRef: string;
  toRef: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  fromPose: ModelPose;
  toPose: ModelPose;
  settings: MotionSegmentSettings;
  configurable: boolean;
  ownerPresetBlockId?: string;
};

export type ResolvedActionSequence = {
  id: number;
  initialPoseByObject: Map<number, ResolvedPosePoint>;
  poses: ResolvedPosePoint[];
  posesByObject: Map<number, ResolvedPosePoint[]>;
  segments: ResolvedMotionSegment[];
  commands: InstructionBlock[];
  totalMs: number;
};

const clonePose = (pose: ModelPose): ModelPose => ({ v1: pose.v1, v2: pose.v2, v3: pose.v3 });

const cloneCommand = (block: InstructionBlock): InstructionBlock => ({
  id: block.id,
  kind: "instruction",
  presetId: "set-enabled",
  objectId: block.objectId,
  atMs: block.atMs,
  instr: { enabled: block.instr.enabled },
  ...(block.label !== undefined ? { label: block.label } : {}),
});

const compareSourceRef = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const cloneSettings = (settings: MotionSegmentSettings): MotionSegmentSettings => ({
  profiles: cloneAxisProfiles(settings.profiles),
});

const defaultSettings = (durationMs: number): MotionSegmentSettings => ({
  profiles: createDefaultAxisProfiles(durationMs),
});

const findSegmentConfig = (
  existing: MotionSegmentConfig[],
  fromRef: string,
  toRef: string,
): MotionSegmentConfig | undefined =>
  existing.find((item) => item.fromRef === fromRef && item.toRef === toRef);

export type ReconcileSegmentOptions = {
  minAccelTimeByObject?: (
    objectId: number,
  ) => Partial<Record<"v1" | "v2" | "v3", number>> | undefined;
};

const AXES = ["v1", "v2", "v3"] as const;

const syncSettingsToTravel = (
  settings: MotionSegmentSettings,
  segment: ResolvedMotionSegment,
  minAccelTimeByAxis: Partial<Record<"v1" | "v2" | "v3", number>> | undefined,
): MotionSegmentSettings => {
  const profiles = { ...settings.profiles };
  for (const axis of AXES) {
    const travel = Math.abs(segment.toPose[axis] - segment.fromPose[axis]);
    profiles[axis] = syncAxisProfileToTravel(
      profiles[axis],
      travel,
      segment.durationMs,
      minAccelTimeByAxis?.[axis],
    );
  }
  return { profiles };
};

export const reconcileSegmentConfigs = (
  resolvedSegments: ResolvedMotionSegment[],
  existing: MotionSegmentConfig[],
  options?: ReconcileSegmentOptions,
): MotionSegmentConfig[] =>
  resolvedSegments.flatMap((segment) => {
    if (!segment.configurable) return [];
    const match = findSegmentConfig(existing, segment.fromRef, segment.toRef);
    const settings = match
      ? cloneSettings(match.settings)
      : options?.minAccelTimeByObject
        ? {
            profiles: createDefaultAxisProfiles(
              segment.durationMs,
              options.minAccelTimeByObject(segment.objectId),
            ),
          }
        : cloneSettings(segment.settings);
    return [{
      fromRef: segment.fromRef,
      toRef: segment.toRef,
      settings: syncSettingsToTravel(
        settings,
        segment,
        options?.minAccelTimeByObject?.(segment.objectId),
      ),
    }];
  });

const dynamicPresetBlocksById = (
  blocks: ActionSequenceConfig["blocks"],
): Map<string, DynamicPresetBlock> => {
  const owners = new Map<string, DynamicPresetBlock>();
  for (const block of blocks) {
    if (block.kind === "dynamic-preset") owners.set(block.id, block);
  }
  return owners;
};

const requireDynamicOwner = (
  owners: Map<string, DynamicPresetBlock>,
  ownerId: string,
): DynamicPresetBlock => {
  const owner = owners.get(ownerId);
  if (owner === undefined) {
    throw new Error(`missing dynamic preset owner: ${ownerId}`);
  }
  return owner;
};

export const resolveActionSequence = (sequence: ActionSequenceConfig): ResolvedActionSequence => {
  const timed: ResolvedPosePoint[] = [];
  const commands: InstructionBlock[] = [];
  let totalMs = 0;

  for (const block of sequence.blocks) {
    if (block.kind === "pose") {
      timed.push({
        sourceRef: block.id,
        sourceBlockId: block.id,
        sourceKind: "pose",
        objectId: block.objectId,
        atMs: block.atMs,
        pose: clonePose(block.pose),
        editable: true,
      });
      totalMs = Math.max(totalMs, block.atMs);
      continue;
    }

    if (block.kind === "instruction") {
      commands.push(cloneCommand(block));
      totalMs = Math.max(totalMs, block.atMs);
      continue;
    }

    if (block.kind === "dynamic-preset") {
      totalMs = Math.max(totalMs, block.endMs);
    } else {
      totalMs = Math.max(totalMs, block.atMs);
    }

    const points = resolvePreset(block);
    for (const point of points) {
      timed.push({
        sourceRef: point.sourceRef,
        sourceBlockId: point.sourceBlockId,
        sourceKind: block.kind,
        objectId: point.objectId,
        atMs: point.atMs,
        pose: clonePose(point.pose),
        editable: false,
      });
      totalMs = Math.max(totalMs, point.atMs);
    }
  }

  timed.sort((left, right) => {
    const delta = left.atMs - right.atMs;
    if (delta !== 0) return delta;
    return compareSourceRef(left.sourceRef, right.sourceRef);
  });

  commands.sort((left, right) => {
    if (left.atMs !== right.atMs) return left.atMs - right.atMs;
    return compareSourceRef(left.id, right.id);
  });

  const posesByObject = new Map<number, ResolvedPosePoint[]>();
  for (const point of timed) {
    const list = posesByObject.get(point.objectId);
    if (list) {
      list.push(point);
    } else {
      posesByObject.set(point.objectId, [point]);
    }
  }

  const initialPoseByObject = new Map<number, ResolvedPosePoint>();
  for (const [objectId, points] of posesByObject) {
    const first = points[0];
    if (first !== undefined) initialPoseByObject.set(objectId, first);
  }

  const owners = dynamicPresetBlocksById(sequence.blocks);
  const segments: ResolvedMotionSegment[] = [];
  const objectIds = [...posesByObject.keys()].sort((a, b) => a - b);

  for (const objectId of objectIds) {
    const series = posesByObject.get(objectId);
    if (series === undefined) continue;

    for (let index = 0; index < series.length - 1; index += 1) {
      const from = series[index];
      const to = series[index + 1];
      if (from === undefined || to === undefined) continue;

      const startMs = from.atMs;
      const endMs = to.atMs;
      const fromRef = from.sourceRef;
      const toRef = to.sourceRef;
      if (
        from.sourceKind === "dynamic-preset" &&
        to.sourceKind === "dynamic-preset" &&
        from.sourceBlockId !== null &&
        from.sourceBlockId === to.sourceBlockId
      ) {
        const block = requireDynamicOwner(owners, from.sourceBlockId);
        segments.push({
          key: `${fromRef}->${toRef}`,
          objectId,
          fromRef,
          toRef,
          startMs,
          endMs,
          durationMs: endMs - startMs,
          fromPose: clonePose(from.pose),
          toPose: clonePose(to.pose),
          settings: {
            profiles: cloneAxisProfiles(block.profiles),
          },
          configurable: false,
          ownerPresetBlockId: block.id,
        });
        continue;
      }

      const match = findSegmentConfig(sequence.segments, fromRef, toRef);
      segments.push({
        key: `${fromRef}->${toRef}`,
        objectId,
        fromRef,
        toRef,
        startMs,
        endMs,
        durationMs: endMs - startMs,
        fromPose: clonePose(from.pose),
        toPose: clonePose(to.pose),
        settings: match === undefined
          ? defaultSettings(endMs - startMs)
          : cloneSettings(match.settings),
        configurable: true,
      });
    }
  }

  return {
    id: sequence.id,
    initialPoseByObject,
    poses: timed,
    posesByObject,
    segments,
    commands,
    totalMs,
  };
};
