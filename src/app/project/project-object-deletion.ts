import { getPresetDefinition } from "./action-sequence/preset-registry";
import { sequenceObjectIds } from "./action-sequence/sequence-object-ids";
import {
  reconcileSegmentConfigs,
  resolveActionSequence,
} from "./action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  MotorConfig,
  ProgramConfig,
  ProjectDocument,
  ProjectSetup,
  SceneGroupConfig,
  TimelineBlock,
} from "./project-document-types";

export type ObjectDeletionImpact = {
  stateId: string;
  objectIds: number[];
  objectNames: string[];
  motorBindingCount: number;
  alignmentCount: number;
  sceneGroupCount: number;
  sceneGroupMemberCount: number;
  sequenceCount: number;
  trackCount: number;
  blockCount: number;
  emptySequenceIds: number[];
  affectedRuleIds: string[];
};

const objectKeyMatchesDeletedId = (key: string, deletedIds: Set<number>): boolean => {
  const numericKey = Number(key);
  return Number.isInteger(numericKey) && deletedIds.has(numericKey);
};

const resolveDeletedIds = (
  document: ProjectDocument,
  objectIds: readonly number[],
): { deletedIds: Set<number>; objectIds: number[]; objectNames: string[] } => {
  const requested = new Set(objectIds);
  const objectIdsOut: number[] = [];
  const objectNames: string[] = [];
  for (const object of document.setup.controlledObjects) {
    if (!requested.has(object.id)) continue;
    objectIdsOut.push(object.id);
    objectNames.push(object.name);
  }
  return { deletedIds: new Set(objectIdsOut), objectIds: objectIdsOut, objectNames };
};

export const analyzeObjectDeletion = (
  document: ProjectDocument,
  objectIds: readonly number[],
  stateId: string,
): ObjectDeletionImpact => {
  const { deletedIds, objectIds: resolvedIds, objectNames } = resolveDeletedIds(
    document,
    objectIds,
  );

  let motorBindingCount = 0;
  for (const motor of document.setup.motors) {
    if (motor.controlledObjectId != null && deletedIds.has(motor.controlledObjectId)) {
      motorBindingCount += 1;
    }
  }

  let alignmentCount = 0;
  for (const key of Object.keys(document.setup.alignment)) {
    if (objectKeyMatchesDeletedId(key, deletedIds)) alignmentCount += 1;
  }

  let sceneGroupCount = 0;
  let sceneGroupMemberCount = 0;
  for (const group of document.setup.scene?.groups ?? []) {
    let groupHit = false;
    for (const memberId of group.objectIds) {
      if (!deletedIds.has(memberId)) continue;
      groupHit = true;
      sceneGroupMemberCount += 1;
    }
    if (groupHit) sceneGroupCount += 1;
  }

  let sequenceCount = 0;
  let trackCount = 0;
  let blockCount = 0;
  const emptySequenceIds: number[] = [];
  for (const sequence of document.motion.actionSequences) {
    const referenced = sequenceObjectIds(sequence);
    const removed = [...referenced].filter((objectId) => deletedIds.has(objectId));
    if (removed.length === 0) continue;
    sequenceCount += 1;
    trackCount += removed.length;
    blockCount += sequence.blocks.filter((block) =>
      blockReferencesDeletedObject(block, deletedIds),
    ).length;
    const stripped = stripSequenceObjects(sequence, deletedIds);
    if (sequenceIsEmpty(stripped) && stripped !== sequence) {
      emptySequenceIds.push(sequence.id);
    }
  }

  return {
    stateId,
    objectIds: resolvedIds,
    objectNames,
    motorBindingCount,
    alignmentCount,
    sceneGroupCount,
    sceneGroupMemberCount,
    sequenceCount,
    trackCount,
    blockCount,
    emptySequenceIds,
    affectedRuleIds: [],
  };
};

const unbindMotor = (motor: MotorConfig, deletedIds: Set<number>): MotorConfig => {
  if (motor.controlledObjectId == null || !deletedIds.has(motor.controlledObjectId)) {
    return motor;
  }
  return { ...motor, controlledObjectId: null, axisKey: null };
};

const filterGroupMembers = (
  group: SceneGroupConfig,
  deletedIds: Set<number>,
): SceneGroupConfig => {
  if (!group.objectIds.some((id) => deletedIds.has(id))) return group;
  return {
    ...group,
    objectIds: group.objectIds.filter((id) => !deletedIds.has(id)),
  };
};

const blockReferencesDeletedObject = (
  block: TimelineBlock,
  deletedIds: Set<number>,
): boolean => {
  if (block.kind === "pose" || block.kind === "instruction") {
    return deletedIds.has(block.objectId);
  }
  return block.orderedObjectIds.some((objectId) => deletedIds.has(objectId));
};

const sequenceIsEmpty = (sequence: ActionSequenceConfig): boolean =>
  sequence.blocks.length === 0;

const stripPresetParticipants = (
  block: Extract<TimelineBlock, { orderedObjectIds: number[] }>,
  deletedIds: Set<number>,
): TimelineBlock | null => {
  const definition = getPresetDefinition(block.presetId);
  if (!definition) return null;
  const orderedObjectIds = block.orderedObjectIds.filter((objectId) => !deletedIds.has(objectId));
  if (orderedObjectIds.length < definition.minObjects) return null;
  if (orderedObjectIds.length === block.orderedObjectIds.length) return block;
  return { ...block, orderedObjectIds };
};

const reconcileStrippedSequence = (sequence: ActionSequenceConfig): ActionSequenceConfig => {
  try {
    const resolved = resolveActionSequence(sequence);
    return {
      ...sequence,
      segments: reconcileSegmentConfigs(resolved.segments, sequence.segments),
    };
  } catch {
    return { ...sequence, segments: [] };
  }
};

const stripSequenceObjects = (
  sequence: ActionSequenceConfig,
  deletedIds: Set<number>,
): ActionSequenceConfig => {
  if (![...sequenceObjectIds(sequence)].some((objectId) => deletedIds.has(objectId))) {
    return sequence;
  }
  const blocks: TimelineBlock[] = [];
  for (const block of sequence.blocks) {
    if (block.kind === "pose" || block.kind === "instruction") {
      if (!deletedIds.has(block.objectId)) blocks.push(block);
      continue;
    }
    const nextBlock = stripPresetParticipants(block, deletedIds);
    if (nextBlock) blocks.push(nextBlock);
  }
  return reconcileStrippedSequence({ ...sequence, blocks });
};

const stripDroppedSequenceProgramRefs = (
  programs: ProgramConfig[],
  droppedSequenceIds: Set<number>,
): ProgramConfig[] => {
  if (droppedSequenceIds.size === 0) return programs;
  let changed = false;
  const nextPrograms = programs.map((program) => {
    let programChanged = false;
    const chapters = program.chapters.map((chapter) => {
      const items = chapter.items.filter(
        (item) => item.kind !== "sequence" || !droppedSequenceIds.has(item.refId),
      );
      if (items.length === chapter.items.length) return chapter;
      programChanged = true;
      changed = true;
      return { ...chapter, items };
    });
    return programChanged ? { ...program, chapters } : program;
  });
  return changed ? nextPrograms : programs;
};

const applySetupDeletion = (
  setup: ProjectSetup,
  deletedIds: Set<number>,
): ProjectSetup => {
  const controlledObjects = setup.controlledObjects.filter(
    (object) => !deletedIds.has(object.id),
  );
  const objectsChanged = controlledObjects.length !== setup.controlledObjects.length;

  let motorsChanged = false;
  const motors = setup.motors.map((motor) => {
    const next = unbindMotor(motor, deletedIds);
    if (next !== motor) motorsChanged = true;
    return next;
  });

  let alignmentChanged = false;
  const alignment: ProjectSetup["alignment"] = {};
  for (const [key, record] of Object.entries(setup.alignment)) {
    if (objectKeyMatchesDeletedId(key, deletedIds)) {
      alignmentChanged = true;
      continue;
    }
    alignment[key] = record;
  }

  let scene = setup.scene;
  let sceneChanged = false;
  if (setup.scene?.groups) {
    let groupsChanged = false;
    const groups = setup.scene.groups.map((group) => {
      const next = filterGroupMembers(group, deletedIds);
      if (next !== group) groupsChanged = true;
      return next;
    });
    if (groupsChanged) {
      scene = { ...setup.scene, groups };
      sceneChanged = true;
    }
  }

  if (!objectsChanged && !motorsChanged && !alignmentChanged && !sceneChanged) {
    return setup;
  }

  return {
    ...setup,
    controlledObjects: objectsChanged ? controlledObjects : setup.controlledObjects,
    motors: motorsChanged ? motors : setup.motors,
    alignment: alignmentChanged ? alignment : setup.alignment,
    ...(sceneChanged ? { scene } : {}),
  };
};

export const applyObjectDeletion = (
  document: ProjectDocument,
  objectIds: readonly number[],
): ProjectDocument => {
  const { deletedIds } = resolveDeletedIds(document, objectIds);
  if (deletedIds.size === 0) return document;

  const setup = applySetupDeletion(document.setup, deletedIds);

  let sequencesChanged = false;
  const droppedSequenceIds = new Set<number>();
  const actionSequences: ActionSequenceConfig[] = [];
  for (const sequence of document.motion.actionSequences) {
    const next = stripSequenceObjects(sequence, deletedIds);
    if (sequenceIsEmpty(next) && next !== sequence) {
      droppedSequenceIds.add(sequence.id);
      sequencesChanged = true;
      continue;
    }
    if (next !== sequence) sequencesChanged = true;
    actionSequences.push(next);
  }

  const programs = stripDroppedSequenceProgramRefs(
    document.motion.programs,
    droppedSequenceIds,
  );
  const programsChanged = programs !== document.motion.programs;

  const motionChanged = sequencesChanged || programsChanged;
  const motion = motionChanged
    ? {
        ...document.motion,
        actionSequences: sequencesChanged
          ? actionSequences
          : document.motion.actionSequences,
        programs: programsChanged ? programs : document.motion.programs,
      }
    : document.motion;

  if (setup === document.setup && motion === document.motion) {
    return document;
  }

  return {
    ...document,
    setup,
    motion,
  };
};
