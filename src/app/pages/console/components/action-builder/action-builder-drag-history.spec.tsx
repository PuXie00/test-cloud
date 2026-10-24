// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import type { ActionBuilderContextValue } from "./action-builder-context-types";
import { ActionBuilderProvider } from "./action-builder-context";
import { useActionBuilder } from "./use-action-builder";
import { TimelineEditor } from "./timeline/timeline-editor";
import { createTimelineProps, installTimelinePaneWidth } from "./timeline/timeline-test-helpers";

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

type Handles = {
  builder: ActionBuilderContextValue;
  project: ReturnType<typeof useProject>;
};

const handles: { current: Handles | null } = { current: null };

/** 时间轴的拖动回调按 editor-dock 的接法连到真实的 ActionBuilder */
const Harness = () => {
  const builder = useActionBuilder();
  const project = useProject();
  handles.current = { builder, project };
  if (!builder.sequence) return null;
  const base = createTimelineProps(builder.sequence, builder.handleSelectionChange);
  return (
    <TimelineEditor
      {...base}
      selection={builder.selection}
      onPoseMove={builder.handleMoveTimelineBlock}
      onPresetMove={builder.handleMoveTimelineBlock}
      onBlocksShift={builder.handleShiftTimelineBlocks}
      onBlocksShiftEnd={builder.handleShiftTimelineBlocksEnd}
      onDynamicPresetResize={builder.handleResizeDynamicPreset}
      onMarkersShift={builder.handleShiftMarkers}
      onMarkersShiftEnd={builder.handleShiftMarkersEnd}
      snapEnabled={false}
    />
  );
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

const insert = (block: TimelineBlock) => act(() => builder().handleInsertTimelineBlock(block));

const pose = (id: string, objectId: number, atMs: number): TimelineBlock => ({
  id,
  kind: "pose",
  objectId,
  atMs,
  pose: { v1: 0, v2: 0, v3: 0 },
});

const blockAt = (id: string) => {
  const block = builder().sequence!.blocks.find((item) => item.id === id)!;
  return block.kind === "dynamic-preset" ? [block.startMs, block.endMs] : "atMs" in block ? block.atMs : null;
};

/** 按下、分几次移动（每次 +stepPx）、松手；100 px/s */
const drag = (target: Element, steps: number, stepPx: number) => {
  fireEvent.pointerDown(target, { clientX: 100, button: 0 });
  for (let i = 1; i <= steps; i += 1) fireEvent.pointerMove(window, { clientX: 100 + i * stepPx });
  fireEvent.pointerUp(window);
};

const undoCount = () => {
  let count = 0;
  while (builder().canUndoEdit) {
    act(() => void builder().handleUndoEdit());
    count += 1;
  }
  return count;
};

let restorePaneWidth: (() => void) | undefined;

describe("one drag = one undo step, through the real timeline", () => {
  beforeEach(() => {
    restorePaneWidth = installTimelinePaneWidth();
    installMemoryProjectAPI();
    stubCsocketOpenProject();
  });

  afterEach(() => {
    cleanup();
    restorePaneWidth?.();
    uninstallMemoryProjectAPI();
    delete window.csocketApi;
    handles.current = null;
  });

  it("dragging a single pose", async () => {
    renderHarness();
    await openWithSequence();
    insert(pose("a", 7, 1000));
    drag(screen.getByRole("button", { name: /位姿 a/ }), 4, 50);
    expect(blockAt("a")).toBe(3000);

    act(() => void builder().handleUndoEdit());
    expect(blockAt("a")).toBe(1000);
  });

  it("dragging two selected poses together", async () => {
    renderHarness();
    await openWithSequence();
    insert(pose("a", 7, 1000));
    insert(pose("b", 8, 1000));
    act(() => builder().handleSelectionChange({ kind: "multi-block", blockIds: ["a", "b"] }));
    drag(screen.getByRole("button", { name: /位姿 a/ }), 4, 50);
    expect([blockAt("a"), blockAt("b")]).toEqual([3000, 3000]);

    act(() => void builder().handleUndoEdit());
    expect([blockAt("a"), blockAt("b")]).toEqual([1000, 1000]);
  });

  it("dragging a dynamic preset and stretching its edge", async () => {
    renderHarness();
    await openWithSequence();
    insert({
      id: "level",
      kind: "dynamic-preset",
      presetId: "dynamic-level",
      startMs: 1000,
      endMs: 3000,
      orderedObjectIds: [7, 8],
      params: { startV1: 0, targetV1: 100, v2: 0, v3: 0 },
      profiles: {
        v1: { kind: "trapezoid", params: { accelMs: 1, decelMs: 1 } },
        v2: { kind: "trapezoid", params: { accelMs: 1, decelMs: 1 } },
        v3: { kind: "trapezoid", params: { accelMs: 1, decelMs: 1 } },
      },
    });
    const preset = () => screen.getAllByRole("button", { name: /动态预设/ })[0]!;
    drag(preset(), 4, 50);
    expect(blockAt("level")).toEqual([3000, 5000]);
    drag(preset().querySelector('[data-resize="end"]')!, 4, 50);
    expect(blockAt("level")).toEqual([3000, 7000]);

    act(() => void builder().handleUndoEdit());
    expect(blockAt("level")).toEqual([3000, 5000]);
    act(() => void builder().handleUndoEdit());
    expect(blockAt("level")).toEqual([1000, 3000]);
  });

  it("dragging a marker", async () => {
    renderHarness();
    await openWithSequence();
    insert(pose("a", 7, 1000));
    act(() => builder().handleCursorChange(1000));
    act(() => void builder().handleAddMarker());
    const markerAt = () => builder().sequence!.markers![0]!.atMs;
    drag(screen.getByRole("button", { name: /标记/ }), 4, 50);
    expect(markerAt()).toBe(3000);

    act(() => void builder().handleUndoEdit());
    expect(markerAt()).toBe(1000);
  });

  it("each whole drag is one step in the history", async () => {
    renderHarness();
    await openWithSequence();
    insert(pose("a", 7, 1000));
    drag(screen.getByRole("button", { name: /位姿 a/ }), 6, 20);
    drag(screen.getByRole("button", { name: /位姿 a/ }), 6, 20);
    // 新建序列、插入、两次拖动
    expect(undoCount()).toBe(4);
  });
});
