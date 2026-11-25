// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ProjectProvider } from "@/app/project/project-provider";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "@/app/project/install-memory-project-api";
import { GZ_2025_RECORD } from "@/app/project/test-fixtures";
import { useProject } from "@/app/project/use-project";
import type { SequenceRefBlock } from "@/app/project/action-sequence/types";
import { ProgramProvider } from "@/app/pages/console/hooks/use-program";
import { ProjectStoreProvider } from "@/app/pages/console/hooks/use-project-store";
import { ActionBuilderProvider } from "./action-builder-context";
import { useActionBuilder } from "./use-action-builder";

const { toastWarning, toastSuccess, toastInfo } = vi.hoisted(() => ({
  toastWarning: vi.fn(),
  toastSuccess: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, warning: toastWarning, error: vi.fn(), info: toastInfo },
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

/** 新建一条序列，物体 7 在给的时刻有给的 v1，保存，返回 id */
const createSaved = (result: Rendered, poses: Array<[number, number]>): number => {
  act(() => result.current.builder.handleCreateSequence([]));
  const id = result.current.builder.selectedSequenceId!;
  act(() => {
    for (const [atMs, v1] of poses) {
      result.current.builder.handleInsertTimelineBlock({
        id: `p-${id}-${atMs}`,
        kind: "pose",
        objectId: 7,
        atMs,
        pose: { v1 },
      });
    }
  });
  act(() => result.current.builder.handleSave());
  return id;
};

const refIn = (result: Rendered): SequenceRefBlock | undefined =>
  result.current.builder.sequence?.blocks.find(
    (block): block is SequenceRefBlock => block.kind === "sequence-ref",
  );

describe("referencing another sequence", () => {
  beforeEach(() => {
    toastWarning.mockClear();
    toastSuccess.mockClear();
    toastInfo.mockClear();
    installMemoryProjectAPI();
    stubCsocketOpenProject();
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
    Reflect.deleteProperty(window, "csocketApi");
  });

  it("inserts a reference at the playhead and follows the source when it is saved", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    // 慢慢走一小段，不超过夹具里物体的速度上限
    const sourceId = createSaved(result, [
      [0, 100],
      [4000, 110],
    ]);
    const parentId = createSaved(result, [[0, 100]]);

    act(() => result.current.builder.handleCursorChange(2000));
    act(() => {
      result.current.builder.handleInsertSequenceRef(sourceId);
    });
    expect(toastWarning).not.toHaveBeenCalled();
    expect(refIn(result)).toMatchObject({ sequenceId: sourceId, atMs: 2000, durationMs: 4000 });
    act(() => result.current.builder.handleSave());

    // 不能再从源序列引用回来
    act(() => result.current.builder.handleSequenceSelect(sourceId));
    let inserted = true;
    act(() => {
      inserted = result.current.builder.handleInsertSequenceRef(parentId);
    });
    expect(inserted).toBe(false);
    expect(toastWarning).toHaveBeenLastCalledWith(expect.stringContaining("不能再引用回去"));

    // 源序列加长后保存：引用跟着变
    act(() => {
      result.current.builder.handleInsertTimelineBlock({
        id: "later",
        kind: "pose",
        objectId: 7,
        atMs: 8000,
        pose: { v1: 100 },
      });
    });
    act(() => result.current.builder.handleSave());
    expect(toastSuccess).toHaveBeenLastCalledWith(expect.stringContaining("引用它的 1 个序列跟着更新"));
    act(() => result.current.builder.handleSequenceSelect(parentId));
    expect(refIn(result)?.durationMs).toBe(8000);

    // 展开：变成普通块，和源序列不再关联
    act(() => result.current.builder.handleExplodeSequenceRefs([refIn(result)!.id]));
    expect(refIn(result)).toBeUndefined();
    expect(result.current.builder.sequence?.blocks.filter((block) => block.kind === "pose")).toHaveLength(4);
  });

  it("creates the transition between two shapes as a new sequence and opens it", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    const fromId = createSaved(result, [[0, 0]]);
    const toId = createSaved(result, [[0, 500]]);
    const count = result.current.builder.sequences.length;
    act(() => {
      result.current.builder.handleCreateTransition(fromId, toId, "sync");
    });
    const created = result.current.builder.sequences.at(-1)!;
    expect(result.current.builder.sequences).toHaveLength(count + 1);
    expect(created.name).toBe("过渡 1");
    expect(result.current.builder.selectedSequenceId).toBe(created.id);
    expect(created.blocks.map((block) => (block.kind === "pose" ? [block.atMs, block.pose.v1] : null))).toEqual([
      [0, 0],
      [expect.any(Number), 500],
    ]);
  });
});
