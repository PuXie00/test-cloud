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

const { toastSuccess, toastWarning } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, warning: toastWarning, error: vi.fn(), info: vi.fn() },
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

const openWithEmptySequence = async (result: Rendered) => {
  await waitFor(() => expect(result.current.project.loading).toBe(false));
  await act(async () => {
    await result.current.project.openProject(GZ_2025_RECORD.folderName);
  });
  await waitFor(() => expect(result.current.project.currentProject?.document).toBeTruthy());
  act(() => result.current.builder.handleCreateSequence([]));
};

const poseAt = (id: string, atMs: number, v1: number): TimelineBlock => ({
  id,
  kind: "pose",
  objectId: 7,
  atMs,
  pose: { v1, v2: 0, v3: 0 },
});

describe("inserting blocks at an occupied time", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastWarning.mockClear();
    installMemoryProjectAPI();
    stubCsocketOpenProject();
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
    delete window.csocketApi;
  });

  it("updates the object's existing pose instead of stacking a second one", async () => {
    const { result } = renderBuilder();
    await openWithEmptySequence(result);
    act(() => {
      result.current.builder.handleInsertTimelineBlock(poseAt("first", 0, 0));
      result.current.builder.handleInsertTimelineBlock(poseAt("existing", 2000, 500));
    });
    act(() => result.current.builder.handleCursorChange(2000));
    act(() => result.current.builder.handleCreatePose([7]));

    const poses = result.current.builder.sequence!.blocks.filter((block) => block.kind === "pose");
    expect(poses.map((block) => block.id)).toEqual(["first", "existing"]);
    // 指针处已有位姿时原样保留，不被默认值覆盖
    expect(poses[1]).toMatchObject({ atMs: 2000, pose: { v1: 500, v2: 0, v3: 0 } });
    expect(result.current.builder.selection).toEqual({ kind: "block", blockId: "existing" });
    expect(toastSuccess).toHaveBeenCalledWith("已更新 1 个物体在 2.0s 的位姿");
    expect(result.current.builder.sequenceIssues.some((issue) => issue.code === "duplicate-pose-time")).toBe(
      false,
    );
  });

  it("defaults a new pose to the sequence value at the playhead and keeps unset axes", async () => {
    const { result } = renderBuilder();
    await openWithEmptySequence(result);
    act(() => {
      result.current.builder.handleInsertTimelineBlock(poseAt("first", 0, 0));
      result.current.builder.handleInsertTimelineBlock(poseAt("last", 4000, 1000));
      result.current.builder.handleInsertTimelineBlock({
        id: "passing",
        kind: "pose",
        objectId: 7,
        atMs: 3000,
        pose: { v1: 750 },
      });
    });
    act(() => result.current.builder.handleCursorChange(1500));
    act(() => result.current.builder.handleCreatePose([7]));
    act(() => result.current.builder.handleCursorChange(3000));
    act(() => result.current.builder.handleCreatePose([7]));

    const byId = new Map(
      result.current.builder.sequence!.blocks.map((block) => [block.id, block] as const),
    );
    const created = [...byId.values()].find(
      (block) => block.kind === "pose" && block.atMs === 1500,
    );
    // 0→750 的 0–3s 默认梯形曲线在 1.5s 走到一半
    expect(created).toMatchObject({ pose: { v1: 375, v2: 0, v3: 0 } });
    // 指针落在已有位姿上：原样保留，不设定的轴还是不设定
    expect(byId.get("passing")).toEqual(expect.objectContaining({ pose: { v1: 750 } }));
  });

  it("leaves axes the sequence never sets unset on a new pose", async () => {
    const { result } = renderBuilder();
    await openWithEmptySequence(result);
    act(() => {
      result.current.builder.handleInsertTimelineBlock({
        id: "first",
        kind: "pose",
        objectId: 7,
        atMs: 0,
        pose: { v1: 0 },
      });
      result.current.builder.handleInsertTimelineBlock({
        id: "last",
        kind: "pose",
        objectId: 7,
        atMs: 4000,
        pose: { v1: 1000 },
      });
    });
    act(() => result.current.builder.handleCursorChange(2000));
    act(() => result.current.builder.handleCreatePose([7]));

    const created = result.current.builder.sequence!.blocks.find(
      (block) => block.kind === "pose" && block.atMs === 2000,
    );
    expect(created).toEqual(expect.objectContaining({ pose: { v1: 500 } }));
  });

  it("updates an existing enable command instead of adding another", async () => {
    const { result } = renderBuilder();
    await openWithEmptySequence(result);
    act(() => result.current.builder.handleCursorChange(1000));
    act(() => result.current.builder.handleCreateSetEnabled([7], true));
    act(() => result.current.builder.handleCreateSetEnabled([7], false));

    const commands = result.current.builder.sequence!.blocks.filter((block) => block.kind === "instruction");
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ atMs: 1000, instr: { enabled: false } });
    expect(toastSuccess).toHaveBeenCalledWith("已更新 1 个物体在 1.0s 的断使能指令");
  });

  it("refuses a pose on a preset key point and names the objects", async () => {
    const { result } = renderBuilder();
    await openWithEmptySequence(result);
    act(() => {
      result.current.builder.handleInsertTimelineBlock({
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
    });
    const before = result.current.builder.sequence!.blocks.length;
    act(() => result.current.builder.handleCursorChange(1000));
    act(() => result.current.builder.handleCreatePose([7, 8]));

    expect(result.current.builder.sequence!.blocks).toHaveLength(before);
    expect(toastWarning).toHaveBeenCalledWith(
      "升降灯架-01、升降摆动架-01 在 1.0s 已有其他动作，未插入位姿",
    );
  });

  it("explains why a direct insert onto an occupied time is refused", async () => {
    const { result } = renderBuilder();
    await openWithEmptySequence(result);
    act(() => {
      result.current.builder.handleInsertTimelineBlock(poseAt("existing", 2000, 500));
    });
    let inserted = true;
    act(() => {
      inserted = result.current.builder.handleInsertTimelineBlock(poseAt("again", 2000, 100));
    });
    expect(inserted).toBe(false);
    expect(toastWarning).toHaveBeenCalledWith("所选物体在该时刻已有动作块，无法插入");
    expect(result.current.builder.sequence!.blocks.map((block) => block.id)).toEqual(["existing"]);
  });
});
