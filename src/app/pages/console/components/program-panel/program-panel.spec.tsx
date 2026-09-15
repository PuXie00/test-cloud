// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyDocument } from "@/app/project/project-document-empty";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { ConsoleModeProvider } from "../../hooks/use-console-mode";
import type { Program } from "./program-data";
import { ProgramPanel } from "./program-panel";

const okSequence: ActionSequenceConfig = {
  id: 15,
  name: "正常序列",
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: "pose-1",
      kind: "pose",
      objectId: 1,
      atMs: 1000,
      pose: { v1: 0, v2: 0, v3: 0 },
    },
  ],
  segments: [],
};

const { programState, actionBuilderState, documentRef } = vi.hoisted(() => ({
  programState: {
    current: {
      id: "program-a",
      name: "节目 A",
      chapters: [] as Program["chapters"],
    } satisfies Program,
  },
  actionBuilderState: {
    current: {
      sequences: [] as ActionSequenceConfig[],
      programs: [] as Array<{
        id: string;
        name: string;
        type: "program";
        children: Array<{
          id: string;
          name: string;
          type: "chapter";
          children: Array<{ id: string; name: string; type: "sequence" }>;
        }>;
      }>,
      handleChapterAdd: vi.fn(),
      handleProgramItemInsert: vi.fn(),
      handleProgramItemRemove: vi.fn(),
      handleProgramItemMove: vi.fn(),
    },
  },
  documentRef: {
    current: null as ReturnType<typeof createEmptyDocument> | null,
  },
}));

vi.mock("../../hooks/use-program", () => ({
  useProgram: () => ({
    program: programState.current,
    currentChapterId: programState.current.chapters[0]?.id ?? "ch-1",
    currentPageIndex: 0,
    setCurrentChapter: vi.fn(),
    nextPage: vi.fn(),
    prevPage: vi.fn(),
    addChapter: vi.fn(),
    addSequence: vi.fn(),
    isProgramEmpty: programState.current.chapters.length === 0,
  }),
}));

vi.mock("../../hooks/use-selection", () => ({
  useSelection: () => ({ clearSelection: vi.fn() }),
}));

vi.mock("../action-builder/use-action-builder", () => ({
  useActionBuilder: () => actionBuilderState.current,
}));

vi.mock("../../hooks/use-exec-cards", () => ({
  useExecCards: () => ({ launch: vi.fn() }),
}));

vi.mock("@/app/project/use-project", () => ({
  useProject: () => ({ currentProject: documentRef.current ? { document: documentRef.current } : null }),
}));

const makeChapterItems = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    kind: "sequence" as const,
    sequence: { id: index + 1, name: `S${index + 1}`, durationMs: 1000 },
  }));

afterEach(() => {
  cleanup();
  programState.current = { id: "program-a", name: "节目 A", chapters: [] };
  actionBuilderState.current.programs = [];
  actionBuilderState.current.sequences = [];
  documentRef.current = null;
});

describe("ProgramPanel variants", () => {
  it("control variant shows current chapter and current page", () => {
    programState.current = {
      id: "program-a",
      name: "节目 A",
      chapters: [
        { id: "ch-1", name: "章节 1", items: makeChapterItems(9) },
        { id: "ch-2", name: "章节 2", items: makeChapterItems(1) },
      ],
    };
    render(
      <ConsoleModeProvider>
        <ProgramPanel variant="control" />
      </ConsoleModeProvider>,
    );
    expect(screen.getByText("当前")).toBeTruthy();
    expect(screen.getByText("页 1/2 · 当前页")).toBeTruthy();
    expect(screen.getByText("2页·9项")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /运行 / })).toBeNull();
  });

  it("authoring variant has no page concept", () => {
    actionBuilderState.current.sequences = [okSequence];
    actionBuilderState.current.programs = [
      {
        id: "program-a",
        name: "节目 A",
        type: "program",
        children: [
          {
            id: "ch-1",
            name: "章节 1",
            type: "chapter",
            children: Array.from({ length: 9 }, (_, index) => ({
              id: String(index + 1),
              name: `S${index + 1}`,
              type: "sequence" as const,
            })),
          },
        ],
      },
    ];
    render(
      <ConsoleModeProvider>
        <ProgramPanel variant="authoring" />
      </ConsoleModeProvider>,
    );
    expect(screen.queryByText(/页 \d+/)).toBeNull();
    expect(screen.queryByText("当前")).toBeNull();
    expect(screen.queryByText("当前页")).toBeNull();
    expect(screen.getByText("9 项")).toBeTruthy();
    expect(screen.getByRole("button", { name: "运行 S1" })).toBeTruthy();
  });
});
