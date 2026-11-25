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

const livePose = { v1: 120, v2: 3, v3: -2 };
const capture = (objectIds: number[]) => ({
  objectIds,
  poseForObject: (objectId: number) => (objectId === 99 ? null : livePose),
});

describe("action builder save current pose", () => {
  beforeEach(() => {
    toastWarning.mockClear();
    toastSuccess.mockClear();
    toastInfo.mockClear();
    installMemoryProjectAPI();
    stubCsocketOpenProject();
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
    delete window.csocketApi;
  });

  it("adds the live pose at the playhead of the selected sequence", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    act(() => result.current.builder.handleCreateSequence([]));
    const sequenceId = result.current.builder.selectedSequenceId;
    act(() => result.current.builder.handleCursorChange(2000));
    act(() => result.current.builder.handleSaveCurrentPose(capture([7, 99])));

    const blocks = result.current.builder.sequence!.blocks;
    expect(blocks).toEqual([
      expect.objectContaining({ kind: "pose", objectId: 7, atMs: 2000, pose: livePose }),
    ]);
    expect(result.current.builder.selectedSequenceId).toBe(sequenceId);
  });

  it("updates selected poses from the live position, leaving passing axes unset", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    act(() => result.current.builder.handleCreateSequence([]));
    act(() => {
      result.current.builder.handleInsertTimelineBlock({
        id: "a",
        kind: "pose",
        objectId: 7,
        atMs: 1000,
        pose: { v1: 400 },
      });
      result.current.builder.handleInsertTimelineBlock({
        id: "b",
        kind: "pose",
        objectId: 8,
        atMs: 1000,
        pose: { v1: 500 },
      });
    });
    const liveFor = (objectId: number) =>
      objectId === 7 ? { v1: 403.46 } : objectId === 8 ? { v1: 512.04, v2: 6 } : null;

    act(() => result.current.builder.handleUpdatePosesFromLive(["a", "b"], liveFor));

    const posesById = new Map(
      result.current.builder.sequence!.blocks.map((block) => [block.id, block] as const),
    );
    expect(posesById.get("a")).toMatchObject({ pose: { v1: 403.5 } });
    // 物体 8 的虚轴2 在这个位姿上是「经过」，取当前不写
    expect(posesById.get("b")).toEqual(expect.objectContaining({ pose: { v1: 512 } }));
    expect(toastSuccess).toHaveBeenCalledWith("已用当前位置更新 2 个位姿");

    act(() => result.current.builder.handleUpdatePosesFromLive(["a", "b"], liveFor));
    expect(toastInfo).toHaveBeenCalledWith("位姿已和当前位置一致");
  });

  it("creates and selects a new sequence when none is selected, without adding it to the program", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    const programsBefore = result.current.project.currentProject!.document!.motion.programs;
    act(() => result.current.builder.handleSequenceSelect(null));
    const countBefore = result.current.builder.sequences.length;

    act(() => result.current.builder.handleSaveCurrentPose(capture([7, 8])));

    const { sequences, selectedSequenceId, sequence } = result.current.builder;
    expect(sequences).toHaveLength(countBefore + 1);
    expect(selectedSequenceId).toBe(sequences.at(-1)!.id);
    expect(sequence!.blocks).toEqual([
      expect.objectContaining({ kind: "pose", objectId: 7, atMs: 0, pose: livePose }),
      expect.objectContaining({ kind: "pose", objectId: 8, atMs: 0, pose: livePose }),
    ]);
    expect(result.current.project.currentProject!.document!.motion.programs).toEqual(programsBefore);
  });

  it("saves the live position as a new 造型 without leaving the sequence being edited", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    act(() => result.current.builder.handleCreateSequence([]));
    const editing = result.current.builder.selectedSequenceId;
    const countBefore = result.current.builder.sequences.length;

    act(() => result.current.builder.handleSaveShape(capture([7, 8])));
    act(() => result.current.builder.handleSaveShape(capture([7])));

    const { sequences, selectedSequenceId } = result.current.builder;
    expect(sequences).toHaveLength(countBefore + 2);
    expect(selectedSequenceId).toBe(editing);
    const [first, second] = sequences.slice(-2);
    expect(first!.name).toBe("造型 1");
    expect(second!.name).toBe("造型 2");
    expect(first!.blocks).toEqual([
      expect.objectContaining({ kind: "pose", objectId: 7, atMs: 0, pose: livePose }),
      expect.objectContaining({ kind: "pose", objectId: 8, atMs: 0, pose: livePose }),
    ]);
    expect(toastSuccess).toHaveBeenCalledWith("已存为「造型 1」");
  });

  it("saves the sequence's values at the playhead as a 造型", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    act(() => result.current.builder.handleCreateSequence([]));
    act(() => {
      result.current.builder.handleInsertTimelineBlock({ id: "a", kind: "pose", objectId: 7, atMs: 0, pose: { v1: 0 } });
      result.current.builder.handleInsertTimelineBlock({
        id: "b",
        kind: "pose",
        objectId: 7,
        atMs: 4000,
        pose: { v1: 800 },
      });
    });
    // 对称梯形走到一半时间正好走一半
    act(() => result.current.builder.handleCursorChange(2000));
    act(() => result.current.builder.handleSaveShapeAtCursor());
    const shape = result.current.builder.sequences.at(-1)!;
    expect(shape.name).toBe("造型 1");
    expect(shape.blocks).toEqual([
      expect.objectContaining({ kind: "pose", objectId: 7, atMs: 0, pose: { v1: 400 } }),
    ]);
  });

  it("keeps the manual tab on object picks, playhead moves and block selection", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    act(() => result.current.builder.setActiveRightTab("manual"));
    act(() => result.current.builder.handleObjectsSelect([7]));
    expect(result.current.builder.activeRightTab).toBe("manual");
    act(() => result.current.builder.handleObjectSelect(8));
    expect(result.current.builder.activeRightTab).toBe("manual");

    // moving the playhead clears the selection but stays in manual control
    act(() => result.current.builder.handleSelectionChange(null));
    expect(result.current.builder.activeRightTab).toBe("manual");

    // 手动控制是联机编辑：选中的位姿成为 GO 目标，所以选块也留在这里
    act(() => result.current.builder.handleSelectionChange({ kind: "block", blockId: "x" }));
    expect(result.current.builder.activeRightTab).toBe("manual");

    act(() => result.current.builder.setActiveRightTab("program"));
    act(() => result.current.builder.handleSelectionChange({ kind: "block", blockId: "x" }));
    expect(result.current.builder.activeRightTab).toBe("selection");

    act(() => result.current.builder.setActiveRightTab("program"));
    act(() => result.current.builder.handleObjectsSelect([7]));
    expect(result.current.builder.activeRightTab).toBe("selection");
  });

  it("keeps 当前位置 in step with the 手动控制 tab", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    expect(result.current.builder.liveMode).toBe(false);
    // 到手动控制就是当前位置
    act(() => result.current.builder.setActiveRightTab("manual"));
    expect(result.current.builder.liveMode).toBe(true);
    // 切到属性就关
    act(() => result.current.builder.setActiveRightTab("selection"));
    expect(result.current.builder.liveMode).toBe(false);
    // 3D 上打开当前位置就到手动控制，关掉回到属性
    act(() => result.current.builder.setLiveMode(true));
    expect(result.current.builder.activeRightTab).toBe("manual");
    act(() => result.current.builder.setLiveMode(false));
    expect(result.current.builder.activeRightTab).toBe("selection");
    expect(result.current.builder.liveMode).toBe(false);
  });
});
