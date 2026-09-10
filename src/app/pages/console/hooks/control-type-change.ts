import { ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE } from "@/app/project/configuration-rules";
import type { ControlType } from "@/app/project/configuration-types";
import {
  reconcileSegmentConfigs,
  resolveActionSequence,
} from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  ModelPose,
  PositionCueConfig,
  ProjectDocument,
  TimelineBlock,
  VirtualAxisId,
  VirtualAxisValues,
} from "@/app/project/project-document-types";
import { hydrateSetupFromDocument } from "@/app/project/setup-hydrate";
import { persistSetupFromWizard } from "@/app/project/setup-persist";
import { countBoundMotorsNeedingAxisTypeChange } from "./binding-utils";
import { changeObjectControlType as changeObjectControlTypeInState } from "./setup-operations";

export type ControlTypeChangeImpact = {
  /** 破坏性变更，需用户确认（而非“控制类型是否发生变化”） */
  changed: boolean;
  removedDriveAxes: number;
  unboundMotors: number;
  axisTypeChangeMotors: number;
  affectedCues: number;
  affectedSequenceTracks: number;
  affectedBlocks: number;
};

export const EMPTY_CONTROL_TYPE_CHANGE_IMPACT: ControlTypeChangeImpact = Object.freeze({
  changed: false,
  removedDriveAxes: 0,
  unboundMotors: 0,
  axisTypeChangeMotors: 0,
  affectedCues: 0,
  affectedSequenceTracks: 0,
  affectedBlocks: 0,
});

export const removedVirtualAxesForChange = (
  currentControlType: ControlType,
  nextControlType: ControlType,
): Set<VirtualAxisId> => {
  const next = new Set<VirtualAxisId>(ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[nextControlType]);
  return new Set<VirtualAxisId>(
    ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[currentControlType].filter(
      (axis) => !next.has(axis),
    ),
  );
};

const resolveTargetIds = (
  document: ProjectDocument,
  objectIds: readonly number[],
): number[] => {
  const existing = new Set(document.setup.controlledObjects.map((object) => object.id));
  return [...new Set(objectIds)].filter((id) => existing.has(id));
};

const transitionSetup = (
  document: ProjectDocument,
  targetIds: readonly number[],
  controlType: ControlType,
) => {
  const hydrated = hydrateSetupFromDocument(document.setup);
  let next = hydrated;
  for (const id of targetIds) {
    next = changeObjectControlTypeInState(next, id, controlType);
  }
  return { hydrated, next };
};

const removedAxesByObject = (
  hydrated: ReturnType<typeof hydrateSetupFromDocument>,
  targetIds: readonly number[],
  controlType: ControlType,
): Map<number, Set<VirtualAxisId>> => {
  const byId = new Map(hydrated.objects.map((object) => [object.id, object]));
  return new Map(
    targetIds.map((id) => {
      const object = byId.get(id);
      const removed = object
        ? removedVirtualAxesForChange(object.controlType, controlType)
        : new Set<VirtualAxisId>();
      return [id, removed] as const;
    }),
  );
};

export const analyzeControlTypeChangeImpact = (
  document: ProjectDocument,
  objectIds: readonly number[],
  controlType: ControlType,
): ControlTypeChangeImpact => {
  const targetIds = resolveTargetIds(document, objectIds);
  if (targetIds.length === 0) return EMPTY_CONTROL_TYPE_CHANGE_IMPACT;

  const { hydrated, next } = transitionSetup(document, targetIds, controlType);
  const oldById = new Map(hydrated.objects.map((object) => [object.id, object]));
  const newById = new Map(next.objects.map((object) => [object.id, object]));
  const targetIdSet = new Set(targetIds);

  let removedDriveAxes = 0;
  let axisTypeChangeMotors = 0;
  for (const id of targetIds) {
    const oldObject = oldById.get(id);
    const newObject = newById.get(id);
    if (!oldObject || !newObject) continue;
    removedDriveAxes += Math.max(0, oldObject.axes.length - newObject.axes.length);
    axisTypeChangeMotors += countBoundMotorsNeedingAxisTypeChange(
      oldObject,
      hydrated.motors,
      controlType,
    );
  }

  const newAxisKeys = new Map(
    targetIds.map((id) => {
      const object = newById.get(id);
      return [id, new Set(object ? object.axes.map((axis) => axis.key) : [])] as const;
    }),
  );
  let unboundMotors = 0;
  for (const motor of hydrated.motors) {
    if (motor.controlledObjectId == null || !targetIdSet.has(motor.controlledObjectId)) continue;
    if (motor.axisKey == null) continue;
    const keys = newAxisKeys.get(motor.controlledObjectId);
    if (!keys || !keys.has(motor.axisKey)) unboundMotors += 1;
  }

  const removedByObject = removedAxesByObject(hydrated, targetIds, controlType);

  let affectedCues = 0;
  for (const cue of document.motion.positionCues) {
    let hit = false;
    for (const [key, values] of Object.entries(cue.targets)) {
      const removed = removedByObject.get(Number(key));
      if (!removed || removed.size === 0) continue;
      if (Object.keys(values ?? {}).some((axis) => removed.has(axis as VirtualAxisId))) {
        hit = true;
        break;
      }
    }
    if (hit) affectedCues += 1;
  }

  let affectedSequenceTracks = 0;
  let affectedBlocks = 0;
  for (const sequence of document.motion.actionSequences) {
    const rewritten = rewriteSequenceRemovedAxes(sequence, removedByObject);
    if (!rewritten.changed) continue;
    affectedSequenceTracks += 1;
    affectedBlocks += rewritten.rewrittenBlocks;
  }

  const changed =
    removedDriveAxes > 0 ||
    unboundMotors > 0 ||
    axisTypeChangeMotors > 0 ||
    affectedCues > 0 ||
    affectedSequenceTracks > 0 ||
    affectedBlocks > 0;

  return {
    changed,
    removedDriveAxes,
    unboundMotors,
    axisTypeChangeMotors,
    affectedCues,
    affectedSequenceTracks,
    affectedBlocks,
  };
};

const stripCueTargets = (
  cue: PositionCueConfig,
  removedByObject: Map<number, Set<VirtualAxisId>>,
): PositionCueConfig => {
  const entries = Object.entries(cue.targets);
  let changed = false;
  const nextTargets: Record<string, VirtualAxisValues> = {};
  for (const [key, values] of entries) {
    const removed = removedByObject.get(Number(key));
    const valueEntries = Object.entries(values ?? {});
    if (valueEntries.length === 0) {
      nextTargets[key] = values;
      continue;
    }
    if (!removed || removed.size === 0) {
      nextTargets[key] = values;
      continue;
    }
    const kept = Object.fromEntries(
      valueEntries.filter(([axis]) => !removed.has(axis as VirtualAxisId)),
    ) as VirtualAxisValues;
    if (Object.keys(kept).length === 0) {
      changed = true;
      continue;
    }
    if (Object.keys(kept).length !== valueEntries.length) changed = true;
    nextTargets[key] = kept;
  }
  if (!changed) return cue;
  return { ...cue, targets: nextTargets };
};

const PRESET_AXIS_PARAM_KEYS: readonly VirtualAxisId[] = ["v2", "v3"];

const zeroPoseRemovedAxes = (
  pose: ModelPose,
  removed: Set<VirtualAxisId>,
): { pose: ModelPose; changed: boolean } => {
  const next: ModelPose = { v1: pose.v1, v2: pose.v2, v3: pose.v3 };
  let changed = false;
  for (const axis of removed) {
    if (axis !== "v1" && axis !== "v2" && axis !== "v3") continue;
    if (next[axis] === 0) continue;
    next[axis] = 0;
    changed = true;
  }
  return { pose: changed ? next : pose, changed };
};

const zeroPresetRemovedAxes = (
  block: Extract<TimelineBlock, { params: Record<string, unknown>; orderedObjectIds: number[] }>,
  removedByObject: Map<number, Set<VirtualAxisId>>,
): { block: TimelineBlock; changed: boolean } => {
  let changed = false;
  const params = { ...block.params };
  for (const objectId of block.orderedObjectIds) {
    const removed = removedByObject.get(objectId);
    if (!removed || removed.size === 0) continue;
    for (const axis of PRESET_AXIS_PARAM_KEYS) {
      if (!removed.has(axis)) continue;
      if (typeof params[axis] !== "number" || params[axis] === 0) continue;
      params[axis] = 0;
      changed = true;
    }
  }
  return { block: changed ? { ...block, params } : block, changed };
};

const rewriteSequenceRemovedAxes = (
  sequence: ActionSequenceConfig,
  removedByObject: Map<number, Set<VirtualAxisId>>,
): { sequence: ActionSequenceConfig; changed: boolean; rewrittenBlocks: number } => {
  let changed = false;
  let rewrittenBlocks = 0;

  const blocks = sequence.blocks.map((block) => {
    if (block.kind === "set-enabled") return block;
    if (block.kind === "pose") {
      const removed = removedByObject.get(block.objectId);
      if (!removed || removed.size === 0) return block;
      const result = zeroPoseRemovedAxes(block.pose, removed);
      if (!result.changed) return block;
      rewrittenBlocks += 1;
      changed = true;
      return { ...block, pose: result.pose };
    }
    const result = zeroPresetRemovedAxes(block, removedByObject);
    if (!result.changed) return block;
    rewrittenBlocks += 1;
    changed = true;
    return result.block;
  });

  if (!changed) {
    return { sequence, changed: false, rewrittenBlocks: 0 };
  }

  const next: ActionSequenceConfig = { ...sequence, blocks };
  try {
    const resolved = resolveActionSequence(next);
    return {
      sequence: {
        ...next,
        segments: reconcileSegmentConfigs(resolved.segments, sequence.segments),
      },
      changed: true,
      rewrittenBlocks,
    };
  } catch {
    return { sequence: { ...next, segments: [] }, changed: true, rewrittenBlocks };
  }
};

export const applyControlTypeChange = (
  document: ProjectDocument,
  objectIds: readonly number[],
  controlType: ControlType,
): ProjectDocument => {
  const targetIds = resolveTargetIds(document, objectIds);
  if (targetIds.length === 0) return document;

  const { hydrated, next } = transitionSetup(document, targetIds, controlType);
  const removedByObject = removedAxesByObject(hydrated, targetIds, controlType);

  let cuesChanged = false;
  const positionCues = document.motion.positionCues.map((cue) => {
    const nextCue = stripCueTargets(cue, removedByObject);
    if (nextCue !== cue) cuesChanged = true;
    return nextCue;
  });

  let sequencesChanged = false;
  const actionSequences = document.motion.actionSequences.map((sequence) => {
    const rewritten = rewriteSequenceRemovedAxes(sequence, removedByObject);
    if (rewritten.changed) sequencesChanged = true;
    return rewritten.sequence;
  });

  const setup = persistSetupFromWizard(next, document.setup);
  const motion =
    cuesChanged || sequencesChanged
      ? {
          ...document.motion,
          positionCues: cuesChanged ? positionCues : document.motion.positionCues,
          actionSequences: sequencesChanged
            ? actionSequences
            : document.motion.actionSequences,
        }
      : document.motion;

  return { ...document, setup, motion };
};
