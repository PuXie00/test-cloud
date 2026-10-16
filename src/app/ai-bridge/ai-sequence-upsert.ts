import type { AiWriteResult } from "@shared/ai-bridge/types";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import {
  hasBlockingSequenceIssues,
  validateActionSequence,
} from "@/app/project/action-sequence/validate-sequence";
import {
  normalizeSequenceName,
  sequenceNameError,
} from "@/app/project/action-sequence/sequence-name";
import {
  actionSequencePathIsClosed,
  SEQUENCE_LOOP_DISABLED_HINT,
} from "@/app/project/action-sequence/sequence-loop";
import { assertActionSequenceStructure } from "@/app/project/project-document-assert";
import type { ProjectDocument } from "@/app/project/project-document-types";
import { validateProjectDocument } from "@/app/project/project-document-validate";
import { sequenceValidationContextFromSetup } from "@/app/project/project-motion-readiness";

export type AiSequenceUpsertPlan = {
  result: AiWriteResult;
  /** 校验通过且有变化时的新文档；否则不改工程 */
  document?: ProjectDocument;
};

const rejected = (
  code: "INVALID_SEQUENCE" | "VALIDATION_FAILED",
  message: string,
  issues?: Extract<AiWriteResult, { ok: false }>["issues"],
): AiSequenceUpsertPlan => ({
  result: { ok: false, code, message, ...(issues ? { issues } : {}) },
});

/** 键序无关的 JSON，用来判断提交的序列与已有的是否完全相同 */
const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : item,
  );

const duplicateBlockId = (sequence: ActionSequenceConfig): string | null => {
  const seen = new Set<string>();
  for (const block of sequence.blocks) {
    if (seen.has(block.id)) return block.id;
    seen.add(block.id);
  }
  return null;
};

/**
 * AI 提交的动作序列：结构与工程文件一致，按 id 新增或整条替换。
 * 与界面同一套校验（结构、序列名、引用、validateActionSequence、循环闭合），有错误即拒绝，只有警告则写入并带回。
 */
export const planAiSequenceUpsert = (
  document: ProjectDocument,
  input: unknown,
): AiSequenceUpsertPlan => {
  try {
    assertActionSequenceStructure(input);
  } catch (error) {
    return rejected("INVALID_SEQUENCE", error instanceof Error ? error.message : String(error));
  }

  const submitted = input as ActionSequenceConfig;
  const sequence: ActionSequenceConfig = { ...submitted, name: normalizeSequenceName(submitted.name) };
  const sequences = document.motion.actionSequences;
  const index = sequences.findIndex((item) => item.id === sequence.id);
  const created = index < 0;

  const nameError = sequenceNameError(
    sequence.name,
    sequences.filter((item) => item.id !== sequence.id).map((item) => item.name),
  );
  if (nameError) return rejected("VALIDATION_FAILED", `序列名：${nameError}`);

  const duplicate = duplicateBlockId(sequence);
  if (duplicate !== null) return rejected("VALIDATION_FAILED", `块 id 重复：${duplicate}`);

  const nextDocument: ProjectDocument = {
    ...document,
    motion: {
      ...document.motion,
      actionSequences: created
        ? [...sequences, sequence]
        : sequences.map((item, position) => (position === index ? sequence : item)),
    },
  };
  const documentCheck = validateProjectDocument(nextDocument);
  if (!documentCheck.ok) return rejected("VALIDATION_FAILED", documentCheck.errors.join("；"));

  const issues = validateActionSequence(sequence, sequenceValidationContextFromSetup(document));
  if (hasBlockingSequenceIssues(issues)) {
    const firstError = issues.find((issue) => issue.severity === "error");
    return rejected("VALIDATION_FAILED", `动作序列校验未通过：${firstError?.message ?? ""}`, issues);
  }
  if (sequence.loop === true && !actionSequencePathIsClosed(sequence)) {
    return rejected("VALIDATION_FAILED", SEQUENCE_LOOP_DISABLED_HINT);
  }

  const result: AiWriteResult = { ok: true, created, changed: true, sequence, warnings: issues };
  if (!created && stableJson(sequences[index]) === stableJson(sequence)) {
    return { result: { ...result, changed: false } };
  }
  return { result, document: nextDocument };
};
