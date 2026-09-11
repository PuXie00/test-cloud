import { isSequenceProgramItemRef, type ProjectDocument, type VirtualAxisId } from "./project-document-types";

export type ValidationResult = { ok: boolean; errors: string[] };

export const validateProjectDocument = (doc: ProjectDocument): ValidationResult => {
  const errors: string[] = [];
  const objectById = new Map(doc.setup.controlledObjects.map((o) => [o.id, o]));
  const seqIds = new Set(doc.motion.actionSequences.map((s) => s.id));

  for (const motor of doc.setup.motors) {
    if (motor.controlledObjectId == null) continue;
    const obj = objectById.get(motor.controlledObjectId);
    if (!obj) {
      errors.push(
        `motor ${motor.id}: unknown controlledObjectId ${motor.controlledObjectId}`,
      );
      continue;
    }
    if (!motor.axisKey) continue;
    if (!obj.driveAxes.some((a) => a.key === motor.axisKey)) {
      errors.push(
        `motor ${motor.id} axisKey "${motor.axisKey}" not on object ${obj.id}`,
      );
    }
  }

  for (const key of Object.keys(doc.setup.alignment)) {
    const objectId = Number(key);
    if (!Number.isInteger(objectId) || !objectById.has(objectId)) {
      errors.push(`alignment: unknown object ${key}`);
    }
  }

  for (const group of doc.setup.scene?.groups ?? []) {
    for (const objectId of group.objectIds) {
      if (!objectById.has(objectId)) {
        errors.push(`scene group ${group.id}: unknown object ${objectId}`);
      }
    }
  }

  for (const cue of doc.motion.positionCues) {
    for (const [objectIdKey, values] of Object.entries(cue.targets)) {
      const objectId = Number(objectIdKey);
      const obj = Number.isInteger(objectId) ? objectById.get(objectId) : undefined;
      if (!obj) {
        errors.push(`cue ${cue.id}: unknown object ${objectIdKey}`);
        continue;
      }
      const enabled = new Set(obj.enabledVirtualAxes);
      for (const key of Object.keys(values ?? {})) {
        if (!enabled.has(key as VirtualAxisId)) {
          errors.push(`cue ${cue.id}: axis ${key} not enabled on ${objectIdKey}`);
        }
      }
    }
  }

  const pushUnknownSequenceObject = (sequenceId: number, objectId: number | string) => {
    errors.push(`sequence ${sequenceId}: unknown object ${objectId}`);
  };

  for (const seq of doc.motion.actionSequences) {
    for (const block of seq.blocks) {
      if (block.kind === "pose" || block.kind === "instruction") {
        if (!objectById.has(block.objectId)) {
          pushUnknownSequenceObject(seq.id, block.objectId);
        }
        continue;
      }
      for (const objectId of block.orderedObjectIds) {
        if (!objectById.has(objectId)) {
          pushUnknownSequenceObject(seq.id, objectId);
        }
      }
    }
  }

  for (const program of doc.motion.programs) {
    for (const chapter of program.chapters) {
      for (const item of chapter.items) {
        if (!isSequenceProgramItemRef(item)) {
          errors.push(`program ${program.id}: item kind must be sequence`);
          continue;
        }
        if (!seqIds.has(item.refId)) {
          errors.push(`program ${program.id}: missing sequence ref ${item.refId}`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
};
