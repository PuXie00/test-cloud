import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  PositionCueConfig,
  ProgramItemRef,
  ProjectMotion,
  VirtualAxisValues,
} from "@/app/project/project-document-types";
import type { Chapter, ChapterItem, Program } from "./program-data";

export type ResolvedChapterItem =
  | { kind: "cue"; cue: PositionCueConfig }
  | { kind: "sequence"; sequence: ActionSequenceConfig };

export const resolveProgramChapterItems = (
  motion: ProjectMotion,
  items: ProgramItemRef[],
): ResolvedChapterItem[] => {
  const cueById = new Map(motion.positionCues.map((c) => [c.id, c]));
  const seqById = new Map(motion.actionSequences.map((s) => [s.id, s]));
  return items.flatMap((item): ResolvedChapterItem[] => {
    if (item.kind === "cue") {
      const cue = cueById.get(item.refId);
      return cue ? [{ kind: "cue" as const, cue }] : [];
    }
    const sequence = seqById.get(item.refId);
    return sequence ? [{ kind: "sequence" as const, sequence }] : [];
  });
};

/** Legacy UI：每物体取 v1 作为单一 targets 数值 */
const virtualTargetsToLegacy = (
  targets: Record<string, VirtualAxisValues>,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [objectId, values] of Object.entries(targets)) {
    if (values.v1 !== undefined) out[objectId] = values.v1;
  }
  return out;
};

const sequenceDisplayDurationMs = (sequence: ActionSequenceConfig): number => {
  try {
    return resolveActionSequence(sequence).totalMs;
  } catch {
    return 0;
  }
};

const resolvedToChapterItems = (resolved: ResolvedChapterItem[]): ChapterItem[] =>
  resolved.map((item) => {
    if (item.kind === "cue") {
      return {
        kind: "cue",
        cue: {
          id: item.cue.id,
          name: item.cue.name,
          note: item.cue.note,
          durationMs: item.cue.durationMs ?? 3000,
          targets: virtualTargetsToLegacy(item.cue.targets),
        },
      };
    }
    return {
      kind: "sequence",
      sequence: {
        id: item.sequence.id,
        name: item.sequence.name,
        ...(item.sequence.note ? { note: item.sequence.note } : {}),
        durationMs: sequenceDisplayDurationMs(item.sequence),
      },
    };
  });

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
