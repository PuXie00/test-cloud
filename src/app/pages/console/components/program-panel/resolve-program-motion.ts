import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import {
  isSequenceProgramItemRef,
  type ActionSequenceConfig,
  type ProgramItemRef,
  type ProjectMotion,
} from "@/app/project/project-document-types";
import type { Chapter, ChapterItem, Program } from "./program-data";

export type ResolvedChapterItem = { kind: "sequence"; sequence: ActionSequenceConfig };

export const resolveProgramChapterItems = (
  motion: ProjectMotion,
  items: ProgramItemRef[],
): ResolvedChapterItem[] => {
  const seqById = new Map(motion.actionSequences.map((s) => [s.id, s]));
  return items.flatMap((item): ResolvedChapterItem[] => {
    if (!isSequenceProgramItemRef(item)) return [];
    const sequence = seqById.get(item.refId);
    return sequence ? [{ kind: "sequence" as const, sequence }] : [];
  });
};

const sequenceDisplayDurationMs = (sequence: ActionSequenceConfig): number => {
  try {
    return resolveActionSequence(sequence).totalMs;
  } catch {
    return 0;
  }
};

const resolvedToChapterItems = (resolved: ResolvedChapterItem[]): ChapterItem[] =>
  resolved.map((item) => ({
    kind: "sequence",
    sequence: {
      id: item.sequence.id,
      name: item.sequence.name,
      ...(item.sequence.note ? { note: item.sequence.note } : {}),
      durationMs: sequenceDisplayDurationMs(item.sequence),
      trajectoryMode: item.sequence.trajectoryMode,
    },
  }));

/** 将 document.motion 中首个（或指定）节目转为嵌入式 Program */
export const motionProgramToLegacyProgram = (
  motion: ProjectMotion,
  programId?: string,
): Program | null => {
  const program = programId
    ? motion.programs.find((p) => p.id === programId)
    : motion.programs[0];
  if (!program) return null;

  const chapters: Chapter[] = program.chapters.map((chapter) => ({
    id: chapter.id,
    name: chapter.name,
    note: chapter.note,
    items: resolvedToChapterItems(resolveProgramChapterItems(motion, chapter.items)),
  }));

  return {
    id: program.id,
    name: program.name,
    note: program.note,
    chapters,
  };
};
