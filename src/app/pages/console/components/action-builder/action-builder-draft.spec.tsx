// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
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

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

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

const pose = (id: string, objectId: number, atMs: number, v1: number): TimelineBlock => ({
  id,
  kind: "pose",
  objectId,
  atMs,
  pose: { v1, v2: 0, v3: 0 },
});

/** 工程里已保存的版本 */
const saved = (result: Rendered, id: number) =>
  result.current.project.currentProject!.document!.motion.actionSequences.find((item) => item.id === id)!;

const createWithTwoPoses = (result: Rendered) => {
  act(() => result.current.builder.handleCreateSequence([]));
  act(() => {
    result.current.builder.handleInsertTimelineBlock(pose("a", 7, 1000, 0));
    result.current.builder.handleInsertTimelineBlock(pose("b", 7, 11_000, 100));
  });
  return result.current.builder.selectedSequenceId!;
};

describe("action builder drafts", () => {
  beforeEach(() => {
    Object.values(toast).forEach((spy) => spy.mockClear());
    installMemoryProjectAPI();
    stubCsocketOpenProject();
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
    delete window.csocketApi;
  });

  it("keeps content edits as a draft until saved, then applies them to the project", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    const id = createWithTwoPoses(result);

    expect(result.current.builder.sequence!.blocks.map((block) => block.id)).toEqual(["a", "b"]);
    expect(result.current.builder.draftSequenceIds.has(id)).toBe(true);
    expect(saved(result, id).blocks).toEqual([]);

    act(() => result.current.builder.handleSave());

    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("节目列表已更新"));
    expect(result.current.builder.draftSequenceIds.has(id)).toBe(false);
    expect(saved(result, id).blocks.map((block) => block.id)).toEqual(["a", "b"]);
    expect(result.current.builder.sequence!.blocks.map((block) => block.id)).toEqual(["a", "b"]);
  });

  it("refuses to save an unrepaired draft and asks to repair it first", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    const id = createWithTwoPoses(result);
    act(() => result.current.builder.handleSave());
    // 2 秒走 1000 万 mm，必然超速
    act(() => result.current.builder.handleInsertTimelineBlock(pose("c", 7, 13_000, 10_000_000)));

    act(() => result.current.builder.handleSave());

    expect(toast.warning).toHaveBeenCalledWith("动作序列有待修复的问题，请先修复再保存");
    expect(result.current.builder.draftSequenceIds.has(id)).toBe(true);
    expect(saved(result, id).blocks.map((block) => block.id)).toEqual(["a", "b"]);
  });

  it("asks to arrange an emptied sequence before saving", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    const id = createWithTwoPoses(result);
    act(() => result.current.builder.handleSave());
    act(() => result.current.builder.handleSelectionChange({ kind: "multi-block", blockIds: ["a", "b"] }));
    act(() => result.current.builder.handleBlockDelete());

    act(() => result.current.builder.handleSave());

    expect(toast.warning).toHaveBeenCalledWith("动作序列为空，请先编排再保存");
    expect(saved(result, id).blocks).toHaveLength(2);
  });

  it("drops the draft when edits return to the saved content", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    act(() => result.current.builder.handleCreateSequence([]));
    const id = result.current.builder.selectedSequenceId!;
    act(() => result.current.builder.handleTrajectoryModeChange(true));
    expect(result.current.builder.draftSequenceIds.has(id)).toBe(true);
    act(() => result.current.builder.handleTrajectoryModeChange(false));
    expect(result.current.builder.draftSequenceIds.has(id)).toBe(false);

    act(() => result.current.builder.handleSave());
    expect(toast.info).toHaveBeenCalledWith("没有未保存的修改");
  });

  it("keeps the draft across sequence switches, renames it, and drops it on delete", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    const id = createWithTwoPoses(result);
    act(() => result.current.builder.handleCreateSequence([]));
    const other = result.current.builder.selectedSequenceId!;
    expect(other).not.toBe(id);

    act(() => result.current.builder.handleSequenceSelect(id));
    expect(result.current.builder.sequence!.blocks).toHaveLength(2);

    act(() => {
      expect(result.current.builder.handleRenameSequence("改名后")).toBeNull();
    });
    expect(saved(result, id).name).toBe("改名后");
    expect(result.current.builder.sequence!.name).toBe("改名后");
    expect(result.current.builder.draftSequenceIds.has(id)).toBe(true);

    act(() => result.current.builder.handleDeleteSequence());
    expect(result.current.builder.draftSequenceIds.has(id)).toBe(false);
  });
});
