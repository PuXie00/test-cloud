// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { ProjectProvider } from "@/app/project/project-provider";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "@/app/project/install-memory-project-api";
import type { PoseBlock, TimelineBlock } from "@/app/project/action-sequence/types";
import { GZ_2025_RECORD } from "@/app/project/test-fixtures";
import { useProject } from "@/app/project/use-project";
import { ProgramProvider } from "@/app/pages/console/hooks/use-program";
import { ProjectStoreProvider } from "@/app/pages/console/hooks/use-project-store";
import type { ActionBuilderContextValue } from "./action-builder-context-types";
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

const handles: { current: { builder: ActionBuilderContextValue; project: ReturnType<typeof useProject> } | null } = {
  current: null,
};

const Harness = () => {
  handles.current = { builder: useActionBuilder(), project: useProject() };
  return null;
};

const renderHarness = () =>
  render(
    <ProjectProvider>
      <ProjectStoreProvider>
        <ProgramProvider>
          <ActionBuilderProvider>
            <Harness />
          </ActionBuilderProvider>
        </ProgramProvider>
      </ProjectStoreProvider>
    </ProjectProvider>,
  );

const builder = () => handles.current!.builder;

const openWithSequence = async () => {
  await waitFor(() => expect(handles.current?.project.loading).toBe(false));
  await act(async () => {
    await handles.current!.project.openProject(GZ_2025_RECORD.folderName);
  });
  await waitFor(() => expect(handles.current?.project.currentProject?.document).toBeTruthy());
  act(() => builder().handleCreateSequence([]));
};

const pose = (id: string, objectId: number, atMs: number, v1 = 0): TimelineBlock => ({
  id,
  kind: "pose",
  objectId,
  atMs,
  pose: { v1, v2: 0, v3: 0 },
});

const insert = (block: TimelineBlock) => act(() => void builder().handleInsertTimelineBlock(block));

const posesOf = (objectId: number) =>
  builder()
    .sequence!.blocks.filter((block): block is PoseBlock => block.kind === "pose" && block.objectId === objectId)
    .map((block) => ({ atMs: block.atMs, v1: block.pose.v1 }));

const undoCount = () => {
  let count = 0;
  while (builder().canUndoEdit) {
    act(() => void builder().handleUndoEdit());
    count += 1;
  }
  return count;
};

describe("3D pose handles in the action editor", () => {
  beforeEach(() => {
    installMemoryProjectAPI();
    stubCsocketOpenProject();
  });

  afterEach(() => {
    cleanup();
    uninstallMemoryProjectAPI();
    Reflect.deleteProperty(window, "csocketApi");
    handles.current = null;
  });

  it("adds the missing pose at the cursor, writes the dragged value and undoes in one step", async () => {
    renderHarness();
    await openWithSequence();
    insert(pose("a", 7, 1000));
    act(() => builder().handleCursorChange(3000));
    const range = builder().getTimelineObject(7)?.rangeByAxis?.v1;
    const expected = Math.min(range?.max ?? Infinity, Math.max(range?.min ?? -Infinity, 250));

    act(() => void expect(builder().handlePoseHandleDragStart([{ objectId: 7, blockId: null, atMs: 3000 }])).toBe(true));
    act(() => builder().handlePoseHandleDrag([{ objectId: 7, values: { v1: 120 } }]));
    act(() => builder().handlePoseHandleDrag([{ objectId: 7, values: { v1: 250 } }]));
    act(() => builder().handlePoseHandleDragEnd(true));

    expect(posesOf(7)).toEqual([
      { atMs: 1000, v1: 0 },
      { atMs: 3000, v1: expected },
    ]);
    const added = builder().sequence!.blocks.find((block) => block.kind === "pose" && block.atMs === 3000)!;
    expect(builder().selection).toEqual({ kind: "block", blockId: added.id });

    act(() => void builder().handleUndoEdit());
    expect(posesOf(7)).toEqual([{ atMs: 1000, v1: 0 }]);
  });

  it("writes a whole formation (start, values, end at once) as one undo step", async () => {
    renderHarness();
    await openWithSequence();
    insert(pose("a", 7, 1000));
    insert(pose("b", 8, 1000));
    act(() => builder().handleCursorChange(3000));
    const clampFor = (objectId: number, value: number) => {
      const range = builder().getTimelineObject(objectId)?.rangeByAxis?.v1;
      return Math.min(range?.max ?? Infinity, Math.max(range?.min ?? -Infinity, value));
    };
    // 右键队形：引擎算好值后一次写完（同 Viz3DPoseHandleSync 收到 poseFormation）
    act(() => {
      const current = builder();
      expect(
        current.handlePoseHandleDragStart([
          { objectId: 7, blockId: null, atMs: 3000 },
          { objectId: 8, blockId: null, atMs: 3000 },
        ]),
      ).toBe(true);
      current.handlePoseHandleDrag([
        { objectId: 7, values: { v1: 300 } },
        { objectId: 8, values: { v1: 100 } },
      ]);
      current.handlePoseHandleDragEnd(true);
    });
    expect(posesOf(7)).toEqual([
      { atMs: 1000, v1: 0 },
      { atMs: 3000, v1: clampFor(7, 300) },
    ]);
    expect(posesOf(8)).toEqual([
      { atMs: 1000, v1: 0 },
      { atMs: 3000, v1: clampFor(8, 100) },
    ]);
    act(() => void builder().handleUndoEdit());
    expect(posesOf(7)).toEqual([{ atMs: 1000, v1: 0 }]);
    expect(posesOf(8)).toEqual([{ atMs: 1000, v1: 0 }]);
  });

  it("asks the timeline to show the cursor when it jumps from the 3D view", async () => {
    renderHarness();
    await openWithSequence();
    insert(pose("a", 7, 5000));
    const before = builder().cursorRevealRequestId;
    act(() => builder().handleCursorChange(2000));
    expect(builder().cursorRevealRequestId).toBe(before);
    act(() => builder().handleCursorChange(4000, { reveal: true }));
    expect(builder().cursorMs).toBe(4000);
    expect(builder().cursorRevealRequestId).toBe(before + 1);
    act(() => builder().handleViewportObjectDoubleClick(7));
    expect(builder().cursorMs).toBe(5000);
    expect(builder().cursorRevealRequestId).toBe(before + 2);
  });

  it("cancelling puts the sequence back without an undo step", async () => {
    renderHarness();
    await openWithSequence();
    insert(pose("a", 7, 1000));
    act(() => builder().handleCursorChange(3000));
    act(() => void builder().handlePoseHandleDragStart([{ objectId: 7, blockId: null, atMs: 3000 }]));
    act(() => builder().handlePoseHandleDrag([{ objectId: 7, values: { v1: 80 } }]));
    act(() => builder().handlePoseHandleDragEnd(false));
    expect(posesOf(7)).toEqual([{ atMs: 1000, v1: 0 }]);
    // 新建序列、插入
    expect(undoCount()).toBe(2);
  });

  it("edits the existing pose and moves several objects in one step", async () => {
    renderHarness();
    await openWithSequence();
    insert(pose("a", 7, 1000));
    insert(pose("b", 8, 1000));
    act(() => builder().handleCursorChange(1000));
    act(
      () =>
        void builder().handlePoseHandleDragStart([
          { objectId: 7, blockId: "a", atMs: 1000 },
          { objectId: 8, blockId: "b", atMs: 1000 },
        ]),
    );
    act(() =>
      builder().handlePoseHandleDrag([
        { objectId: 7, values: { v1: 30 } },
        { objectId: 8, values: { v1: 40 } },
      ]),
    );
    act(() => builder().handlePoseHandleDragEnd(true));
    expect([posesOf(7), posesOf(8)]).toEqual([[{ atMs: 1000, v1: 30 }], [{ atMs: 1000, v1: 40 }]]);
    expect(builder().selection).toEqual({ kind: "multi-block", blockIds: ["a", "b"] });
    expect(undoCount()).toBe(4);
  });

  it("clicking an object in 3D selects its pose at the cursor and keeps it when the selection syncs back", async () => {
    renderHarness();
    await openWithSequence();
    insert(pose("a", 7, 1000));
    act(() => builder().handleCursorChange(1000));
    act(() => builder().handleViewportObjectsPick([7], true));
    expect(builder().selection).toEqual({ kind: "block", blockId: "a" });
    expect(builder().selectedObjectIds).toEqual([7]);
    act(() => builder().handleObjectsSelect([7]));
    expect(builder().selection).toEqual({ kind: "block", blockId: "a" });

    // 游标不在它的位姿上：只选物体（全局选中同步回来时清掉位姿）
    act(() => builder().handleCursorChange(1500));
    act(() => builder().handleViewportObjectsPick([7, 8], true));
    act(() => builder().handleObjectsSelect([8, 7]));
    expect(builder().selection).toBeNull();
    expect(builder().selectedObjectIds).toEqual([8, 7]);
  });

  it("double-clicking an object jumps to its nearest pose", async () => {
    renderHarness();
    await openWithSequence();
    insert(pose("a", 7, 1000));
    insert(pose("b", 7, 4000));
    act(() => builder().handleCursorChange(3000));
    act(() => builder().handleViewportObjectDoubleClick(7));
    expect(builder().cursorMs).toBe(4000);
    expect(builder().selection).toEqual({ kind: "block", blockId: "b" });
  });
});
