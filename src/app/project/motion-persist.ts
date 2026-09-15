import type { Program } from "@/app/pages/console/components/program-panel/program-data";
import type { ProgramNode } from "@/app/pages/console/components/action-builder/timeline/timeline-data";
import type {
  ActionSequenceConfig,
  ProgramChapterConfig,
  ProgramConfig,
  ProgramItemRef,
  ProjectMotion,
} from "./project-document-types";

const programNodeToChapter = (node: ProgramNode): ProgramChapterConfig => ({
  id: node.id,
  name: node.name,
  items: (node.children ?? []).flatMap((child): ProgramItemRef[] => {
    if (child.type === "cue") return [];
    if (child.type === "sequence") {
      const refId = Number(child.id);
      if (!Number.isInteger(refId)) return [];
      return [{ kind: "sequence", refId }];
    }
    return [];
  }),
});

const programNodeToConfig = (node: ProgramNode): ProgramConfig => ({
  id: node.id,
  name: node.name,
  chapters: (node.children ?? [])
    .filter((child) => child.type === "chapter")
    .map(programNodeToChapter),
});

const programToConfig = (program: Program): ProgramConfig => ({
  id: program.id,
  name: program.name,
  note: program.note,
  chapters: program.chapters.map((ch) => ({
    id: ch.id,
    name: ch.name,
    note: ch.note,
    items: ch.items.map((item): ProgramItemRef => ({
      kind: "sequence",
      refId: item.sequence.id,
    })),
  })),
});

export const legacyProgramToMotion = (program: Program, existing: ProjectMotion): ProjectMotion => {
  const programs =
    existing.programs.length > 0
      ? existing.programs.map((p, index) => (index === 0 ? programToConfig(program) : p))
      : [programToConfig(program)];

  return {
    actionSequences: structuredClone(existing.actionSequences),
    programs,
  };
};

export const actionBuilderStateToMotion = (
  state: { sequences: ActionSequenceConfig[]; programs: ProgramNode[] },
  existing: ProjectMotion,
): ProjectMotion => ({
  actionSequences: structuredClone(state.sequences),
  programs:
    state.programs.length > 0
      ? state.programs.filter((n) => n.type === "program" || !n.type).map(programNodeToConfig)
      : existing.programs,
});
