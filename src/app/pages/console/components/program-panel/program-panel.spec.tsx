// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

const {
  togglePreviewMock,
  startPreviewMock,
  stopPreviewMock,
  previewSequenceIdRef,
} = vi.hoisted(() => ({
  togglePreviewMock: vi.fn(),
  startPreviewMock: vi.fn(),
  stopPreviewMock: vi.fn(),
  previewSequenceIdRef: { current: null as number | null },
}));

vi.mock("../../hooks/sequence-preview-provider", () => ({
  useSequencePreview: () => ({
    sequenceId: previewSequenceIdRef.current,
    togglePreview: togglePreviewMock,
    startPreview: startPreviewMock,
    stopPreview: stopPreviewMock,
    cursorMs: 0,
    isPlaying: false,
    holdMode: false,
    faderPercent: 100,
    multiplier: 1,
    totalMs: 0,
    resolved: null,
    setCursorMs: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    setMultiplier: vi.fn(),
  }),
}));

const makeChapterItems = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    kind: "sequence" as const,
    sequence: { id: index + 1, name: `S${index + 1}`, durationMs: 1000 },
  }));

afterEach(() => {
  cleanup();
  togglePreviewMock.mockClear();
  startPreviewMock.mockClear();
  stopPreviewMock.mockClear();
  previewSequenceIdRef.current = null;
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
        { id: "ch-1", name: "章节 1", items: makeChapterItems(13) },
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
    expect(screen.getByText("2页·13项")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /运行 / })).toBeNull();
    expect(screen.queryByRole("button", { name: "序列" })).toBeNull();
    expect(screen.queryByText("强制")).toBeNull();
  });

  it("control variant row click toggles sequence preview", () => {
    programState.current = {
      id: "program-a",
      name: "节目 A",
      chapters: [{ id: "ch-1", name: "章节 1", items: makeChapterItems(2) }],
    };
    render(
      <ConsoleModeProvider>
        <ProgramPanel variant="control" />
      </ConsoleModeProvider>,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: "S1" }));
    expect(togglePreviewMock).toHaveBeenCalledWith(1);
  });

  it("control variant marks only forced sequences", () => {
    programState.current = {
      id: "program-a",
      name: "节目 A",
      chapters: [
        {
          id: "ch-1",
          name: "章节 1",
          items: [
            { kind: "sequence", sequence: { id: 1, name: "非强制A", durationMs: 1000 } },
            {
              kind: "sequence",
              sequence: { id: 2, name: "强制B", durationMs: 1000, trajectoryMode: "forced" },
            },
          ],
        },
      ],
    };
    render(
      <ConsoleModeProvider>
        <ProgramPanel variant="control" />
      </ConsoleModeProvider>,
    );
    expect(screen.getByRole("treeitem", { name: "非强制A" })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: "强制B，强制轨迹" })).toBeTruthy();
    expect(screen.getByText("强制")).toBeTruthy();
  });

  it("authoring variant shows pages without current chapter or page", () => {
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
            children: Array.from({ length: 13 }, (_, index) => ({
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
    expect(screen.queryByText("当前")).toBeNull();
    expect(screen.queryByText("当前页")).toBeNull();
    expect(screen.getByText("页 1/2")).toBeTruthy();
    expect(screen.getByText("2页·13项")).toBeTruthy();
    expect(screen.getByRole("button", { name: "运行 S1" })).toBeTruthy();
  });
});
