// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ProjectProvider } from "@/app/project/project-provider";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "@/app/project/install-memory-project-api";
import type { TimelineBlock } from "@/app/project/action-sequence/types";
import { GZ_2025_RECORD } from "@/app/project/test-fixtures";
import { useProject } from "@/app/project/use-project";
import { ProgramProvider } from "@/app/pages/console/hooks/use-program";
import { ProjectStoreProvider } from "@/app/pages/console/hooks/use-project-store";
import { ActionBuilderProvider } from "./action-builder-context";
import { useActionBuilder } from "./use-action-builder";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const stubCsocketOpenProject = () => {
  const ok = async () => ({ ok: true as const, data: { success: true as const } });
  window.csocketApi = {
    openProject: ok,
    addModelWithDefaultValues: ok,
    modifyModelType: ok,
    configureModelParamModel: ok,
    deleteModelPlc: ok,
  } as unknown as Window["csocketApi"];
};

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    ProjectProvider,
    null,
    createElement(
      ProjectStoreProvider,
      null,
      createElement(ProgramProvider, null, createElement(ActionBuilderProvider, null, children)),
    ),
  );

const renderBuilder = () =>
  renderHook(() => ({ builder: useActionBuilder(), project: useProject() }), { wrapper });

type Rendered = ReturnType<typeof renderBuilder>["result"];

const openFixtureProject = async (result: Rendered) => {
  await waitFor(() => expect(result.current.project.loading).toBe(false));
  await act(async () => {
    await result.current.project.openProject(GZ_2025_RECORD.folderName);
  });
  await waitFor(() => expect(result.current.project.currentProject?.document).toBeTruthy());
};

const pose = (id: string, atMs: number, v1: number): TimelineBlock => ({
  id,
  kind: "pose",
  objectId: 7,
  atMs,
  pose: { v1, v2: 0, v3: 0 },
});

const document = (result: Rendered) => result.current.project.currentProject!.document!;
const saved = (result: Rendered, id: number) =>
  document(result).motion.actionSequences.find((item) => item.id === id);
const blockIds = (result: Rendered) => result.current.builder.sequence?.blocks.map((block) => block.id);

const undo = (result: Rendered) => act(() => void result.current.builder.handleUndoEdit());
const redo = (result: Rendered) => act(() => void result.current.builder.handleRedoEdit());

const createSequence = (result: Rendered) => {
  act(() => result.current.builder.handleCreateSequence([]));
  return result.current.builder.selectedSequenceId!;
};

const insert = (result: Rendered, block: TimelineBlock) =>
  act(() => result.current.builder.handleInsertTimelineBlock(block));

describe("action editor undo / redo", () => {
  beforeEach(() => {
    installMemoryProjectAPI();
    stubCsocketOpenProject();
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
    delete window.csocketApi;
  });

  it("undoes and redoes content edits one action at a time", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    createSequence(result);
    insert(result, pose("a", 1000, 0));
    insert(result, pose("b", 11_000, 100));

    undo(result);
    expect(blockIds(result)).toEqual(["a"]);
    undo(result);
    expect(blockIds(result)).toEqual([]);
    redo(result);
    expect(blockIds(result)).toEqual(["a"]);

    // 撤销后做新的修改就不能再重做
    insert(result, pose("c", 5000, 50));
    expect(result.current.builder.canRedoEdit).toBe(false);
  });

  it("records a whole drag as one step", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    createSequence(result);
    insert(result, pose("a", 1000, 0));
    act(() => result.current.builder.handleShiftTimelineBlocks(["a"], 500));
    act(() => result.current.builder.handleShiftTimelineBlocks(["a"], 1000));
    act(() => result.current.builder.handleShiftTimelineBlocks(["a"], 1500));
    act(() => result.current.builder.handleShiftTimelineBlocksEnd());
    expect(result.current.builder.sequence!.blocks[0]!.atMs).toBe(2500);

    undo(result);
    expect(result.current.builder.sequence!.blocks[0]!.atMs).toBe(1000);
    undo(result);
    expect(blockIds(result)).toEqual([]);
  });

  it("merges every edit made while the pointer is held into one step (e.g. dragging a speed handle)", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    createSequence(result);
    insert(result, pose("a", 1000, 0));
    insert(result, pose("b", 11_000, 100));
    const accelMs = () =>
      result.current.builder.sequence!.segments[0]?.settings.profiles.v1.kind === "trapezoid"
        ? (result.current.builder.sequence!.segments[0]!.settings.profiles.v1.params as { accelMs: number }).accelMs
        : null;
    const profiles = (ms: number) => ({
      profiles: {
        v1: { kind: "trapezoid" as const, params: { accelMs: ms, decelMs: 1000 } },
        v2: { kind: "idle" as const },
        v3: { kind: "idle" as const },
      },
    });

    const before = accelMs();
    fireEvent.pointerDown(window);
    for (const ms of [1000, 1500, 2000]) {
      act(() => result.current.builder.handleUpdateSegmentSettings("a", "b", profiles(ms)));
    }
    fireEvent.pointerUp(window);
    expect(accelMs()).toBe(2000);

    // 一次撤销直接回到按下之前，不是退回 1500
    undo(result);
    expect(accelMs()).toBe(before);
    expect(before).not.toBe(1500);
    expect(blockIds(result)).toEqual(["a", "b"]);
    undo(result);
    expect(blockIds(result)).toEqual(["a"]);
  });

  it("keeps the history across save, and undoing past it brings the draft back", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    const id = createSequence(result);
    insert(result, pose("a", 1000, 0));
    insert(result, pose("b", 11_000, 100));
    act(() => result.current.builder.handleSave());
    expect(saved(result, id)!.blocks).toHaveLength(2);
    expect(result.current.builder.canUndoEdit).toBe(true);

    undo(result);
    expect(blockIds(result)).toEqual(["a"]);
    // 保存不撤销：节目列表用的版本不变，序列重新变成未保存
    expect(saved(result, id)!.blocks).toHaveLength(2);
    expect(result.current.builder.draftSequenceIds.has(id)).toBe(true);

    redo(result);
    expect(result.current.builder.draftSequenceIds.has(id)).toBe(false);
  });

  it("undoes a rename in the project and the program list", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    const id = createSequence(result);
    const before = saved(result, id)!.name;
    act(() => {
      expect(result.current.builder.handleRenameSequence("新名字")).toBeNull();
    });
    expect(saved(result, id)!.name).toBe("新名字");

    undo(result);
    expect(saved(result, id)!.name).toBe(before);
    expect(result.current.builder.sequence!.name).toBe(before);
    redo(result);
    expect(saved(result, id)!.name).toBe("新名字");
  });

  it("brings a deleted sequence back with its draft, and removes an undone new one", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    const id = createSequence(result);
    insert(result, pose("a", 1000, 0));
    act(() => result.current.builder.handleDeleteSequence());
    expect(saved(result, id)).toBeUndefined();

    undo(result);
    expect(saved(result, id)).toBeDefined();
    expect(result.current.builder.selectedSequenceId).toBe(id);
    expect(blockIds(result)).toEqual(["a"]);
    expect(result.current.builder.draftSequenceIds.has(id)).toBe(true);

    undo(result);
    undo(result);
    expect(saved(result, id)).toBeUndefined();
    expect(result.current.builder.canUndoEdit).toBe(false);
  });

  it("switches to the sequence the undo changed", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    const first = createSequence(result);
    insert(result, pose("a", 1000, 0));
    const second = createSequence(result);
    act(() => result.current.builder.handleSequenceSelect(first));
    act(() => result.current.builder.handleSequenceSelect(second));

    undo(result); // 撤销新建第二条序列
    expect(saved(result, second)).toBeUndefined();
    expect(result.current.builder.selectedSequenceId).toBe(first);
    undo(result); // 撤销第一条序列里插入的块
    expect(result.current.builder.selectedSequenceId).toBe(first);
    expect(blockIds(result)).toEqual([]);
  });

  it("undoes program list edits made in the editor", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    const chapters = () => document(result).motion.programs[0]?.chapters.length ?? 0;
    const before = chapters();
    act(() => result.current.builder.handleChapterAdd());
    expect(chapters()).toBe(before + 1);
    undo(result);
    expect(chapters()).toBe(before);
  });

  it("clears the history when motion changes outside the editor", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    createSequence(result);
    expect(result.current.builder.canUndoEdit).toBe(true);
    act(() => {
      result.current.project.updateCurrentDocument(
        (doc) => ({ ...doc, motion: { ...doc.motion, programs: [...doc.motion.programs] } }),
        "program",
      );
    });
    await waitFor(() => expect(result.current.builder.canUndoEdit).toBe(false));
  });
});
