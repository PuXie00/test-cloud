import { buildMotorOverspeedObjects } from "@/app/kinematics/motor-overspeed-from-setup";
import { decodeControlType } from "./control-type-code";
import {
  hasBlockingSequenceIssues,
  validateActionSequence,
  type SequenceValidationContext,
} from "./action-sequence/validate-sequence";
import { isSequenceProgramItemRef, type ActionSequenceConfig, type ControlledObjectConfig, type MotorConfig, type ProjectDocument } from "./project-document-types";
import { motionAxisIdForVirtualAxis } from "./virtual-axis-mapping";
import { resolveVirtualAxisMaxVelocity } from "./virtual-axis-max-velocity";

export type MotionRepairIssue = {
  code: "empty-sequence" | "program-ref-empty";
  itemId: string | number;
  message: string;
};

const EMPTY_SEQUENCE_MESSAGE = "动作序列存在校验错误，待修复";
const EMPTY_SEQUENCE_PENDING_MESSAGE = "动作序列为空，待编排";
const MISSING_SEQUENCE_MESSAGE = "动作序列不可用，待修复";

const limitsFromObject = (
  object: ControlledObjectConfig,
  motors: readonly MotorConfig[],
): SequenceValidationContext["objects"][number]["limits"] => {
  const limits: SequenceValidationContext["objects"][number]["limits"] = {};
  const resolved = resolveVirtualAxisMaxVelocity(object, motors);
  for (const axis of object.enabledVirtualAxes) {
    const params = object.motionParams[motionAxisIdForVirtualAxis(axis)];
    if (!params) continue;
    limits[axis] = {
      min: params.minAngle,
      max: params.maxAngle,
      maxVelocity: resolved[axis],
      minAccelTime: params.minAccelTime,
    };
  }
  return limits;
};

export const sequenceValidationContextFromSetup = (
  document: ProjectDocument,
): SequenceValidationContext => ({
  objects: document.setup.controlledObjects.map((object) => ({
    id: object.id,
    enabledVirtualAxes: [...object.enabledVirtualAxes],
    limits: limitsFromObject(object, document.setup.motors),
    ...(decodeControlType(object.controlType) === "multiPointSwing" &&
    object.safetyRadius !== undefined
      ? { safetyRadius: object.safetyRadius }
      : {}),
  })),
  hoistObjects: buildMotorOverspeedObjects(
    document.setup.controlledObjects,
    document.setup.motors,
  ),
});

const sequenceHasBlockingIssues = (
  document: ProjectDocument,
  sequence: ActionSequenceConfig,
): boolean => {
  try {
    return hasBlockingSequenceIssues(
      validateActionSequence(sequence, sequenceValidationContextFromSetup(document)),
    );
  } catch {
    return true;
  }
};

/**
 * Pure readiness for a sequence by kind+id.
 * Missing items fail closed (not executable); structural validators still own schema errors.
 */
export const getMotionItemRepairIssue = (
  document: ProjectDocument,
  kind: "sequence",
  itemId: string | number,
): MotionRepairIssue | null => {
  const sequence = document.motion.actionSequences.find((entry) => entry.id === itemId);
  if (!sequence) {
    return {
      code: "empty-sequence",
      itemId,
      message: MISSING_SEQUENCE_MESSAGE,
    };
  }
  return getSequenceContentRepairIssue(document, sequence);
};

/** 按给定的序列内容判断是否待修复，不读工程里已保存的版本（动作编辑器的草稿用） */
export const getSequenceContentRepairIssue = (
  document: ProjectDocument,
  sequence: ActionSequenceConfig,
): MotionRepairIssue | null => {
  if (sequence.blocks.length === 0) {
    return {
      code: "empty-sequence",
      itemId: sequence.id,
      message: EMPTY_SEQUENCE_PENDING_MESSAGE,
    };
  }
  if (sequenceHasBlockingIssues(document, sequence)) {
    return {
      code: "empty-sequence",
      itemId: sequence.id,
      message: EMPTY_SEQUENCE_MESSAGE,
    };
  }
  return null;
};

/**
 * Launch-path gate: missing document or unrepaired/missing item → issue (fail closed).
 * Callers toast + return before launch; do not rely on disabled UI alone.
 */
export const resolveMotionLaunchBlock = (
  document: ProjectDocument | null | undefined,
  kind: "sequence",
  itemId: string | number,
): MotionRepairIssue | null => {
  if (!document) {
    return {
      code: "empty-sequence",
      itemId,
      message: MISSING_SEQUENCE_MESSAGE,
    };
  }
  return getMotionItemRepairIssue(document, kind, itemId);
};

/**
 * Program-level derived repair issues (empty or missing refs). Fail closed for execution UI.
 * Structural validators still reject dangling refs on commit where applicable.
 */
export const getProgramRepairIssues = (
  document: ProjectDocument,
  programId: string,
): MotionRepairIssue[] => {
  const program = document.motion.programs.find((entry) => entry.id === programId);
  if (!program) return [];

  const issues: MotionRepairIssue[] = [];
  const seen = new Set<string>();

  for (const chapter of program.chapters) {
    for (const item of chapter.items) {
      if (!isSequenceProgramItemRef(item)) continue;
      const key = `${item.kind}:${item.refId}`;
      if (seen.has(key)) continue;

      const itemIssue = getMotionItemRepairIssue(document, item.kind, item.refId);
      if (!itemIssue) continue;

      seen.add(key);
      const missing = itemIssue.message === MISSING_SEQUENCE_MESSAGE;
      issues.push({
        code: "program-ref-empty",
        itemId: item.refId,
        message: missing
          ? `节目引用不可用动作序列「${item.refId}」，待修复`
          : `节目引用空动作序列「${item.refId}」，待修复`,
      });
    }
  }

  return issues;
};
