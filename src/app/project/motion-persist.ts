import type { Program } from "@/app/pages/console/components/program-panel/program-data";
import type { CueItem, ProgramNode } from "@/app/pages/console/components/action-builder/timeline/timeline-data";
import type {
  ActionSequenceConfig,
  PositionCueConfig,
  ProgramChapterConfig,
  ProgramConfig,
  ProgramItemRef,
  ProjectMotion,
  VirtualAxisValues,
} from "./project-document-types";

const legacyPositionsToVirtualTargets = (
  targets: Record<string, number>,
): Record<string, VirtualAxisValues> => {
  const out: Record<string, VirtualAxisValues> = {};
  for (const [objectId, v1] of Object.entries(targets)) {
    out[objectId] = { v1 };
  }
  return out;
};

export const cueItemToPositionCueConfig = (cue: CueItem): PositionCueConfig => ({
  id: cue.id,
  name: cue.name,
  note: cue.note,
  targets: structuredClone(cue.targets),
});

/** 控制界面 legacy Program 中的 Cue（单值 targets）→ 文档 Cue */
const legacyCueToPositionCueConfig = (cue: {
  id: string;
  name: string;
  note?: string;
  durationMs?: number;
  targets?: Record<string, number>;
}): PositionCueConfig => ({
  id: cue.id,
  name: cue.name,
  note: cue.note,
  durationMs: cue.durationMs ?? 3000,
  targets: legacyPositionsToVirtualTargets(cue.targets ?? {}),
});

const programNodeToChapter = (node: ProgramNode): ProgramChapterConfig => ({
  id: node.id,
  name: node.name,
  items: (node.children ?? []).flatMap((child): ProgramItemRef[] => {
    if (child.type === "cue") return [{ kind: "cue", refId: child.id }];
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
    items: ch.items.map((item): ProgramItemRef =>
      item.kind === "cue"
        ? { kind: "cue", refId: item.cue.id }
        : { kind: "sequence", refId: item.sequence.id },
    ),
  })),
});

export const legacyProgramToMotion = (program: Program, existing: ProjectMotion): ProjectMotion => {
  const cueById = new Map(existing.positionCues.map((c) => [c.id, c]));

  for (const chapter of program.chapters) {
    for (const item of chapter.items) {
      if (item.kind !== "cue") continue;
      const prev = cueById.get(item.cue.id);
      cueById.set(
        item.cue.id,
        prev
          ? { ...prev, name: item.cue.name, note: item.cue.note, durationMs: item.cue.durationMs }
          : legacyCueToPositionCueConfig(item.cue),
      );
    }
  }

  const programs =
    existing.programs.length > 0
      ? existing.programs.map((p, index) => (index === 0 ? programToConfig(program) : p))
      : [programToConfig(program)];

  const actionSequences = structuredClone(existing.actionSequences);

  return {
    positionCues: [...cueById.values()],
    actionSequences,
    programs,
  };
};

export const actionBuilderStateToMotion = (
  state: { sequences: ActionSequenceConfig[]; cues: CueItem[]; programs: ProgramNode[] },
  existing: ProjectMotion,
): ProjectMotion => ({
  positionCues: state.cues.map((cue) => cueItemToPositionCueConfig(cue)),
  actionSequences: structuredClone(state.sequences),
  programs:
    state.programs.length > 0
      ? state.programs.filter((n) => n.type === "program" || !n.type).map(programNodeToConfig)
      : existing.programs,
});
