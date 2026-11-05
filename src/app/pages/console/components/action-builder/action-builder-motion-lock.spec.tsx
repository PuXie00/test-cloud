// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, Fragment, type ReactNode } from "react";
import { ProjectProvider } from "@/app/project/project-provider";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "@/app/project/install-memory-project-api";
import type { TimelineBlock } from "@/app/project/action-sequence/types";
import { GZ_2025_RECORD } from "@/app/project/test-fixtures";
import { useProject } from "@/app/project/use-project";
import { AxisMotionEditLockSync, AxisMotionProvider } from "@/app/pages/console/hooks/axis-motion";
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

const LOCK = "1 个轴运动中，动作暂时不能保存";

let emitAxis: (msg: unknown) => void = () => undefined;

const stubCsocket = () => {
  const ok = async () => ({ ok: true as const, data: { success: true as const } });
  window.csocketApi = {
    openProject: ok,
    addModelWithDefaultValues: ok,
    modifyModelType: ok,
    configureModelParamModel: ok,
    deleteModelPlc: ok,
    onReadAxisInfoPolling: (cb: (msg: unknown) => void) => {
      emitAxis = cb;
      return () => undefined;
    },
    getAxisInfoSnapshot: async () => ({ success: true, data: [] }),
  } as unknown as Window["csocketApi"];
};

const setAxisMoving = (moving: boolean) =>
  act(() => emitAxis({ success: true, data: [{ deviceId: 1, axisStatus: moving ? 3 : 2 }] }));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    ProjectProvider,
    null,
    createElement(
      AxisMotionProvider,
      null,
      createElement(
        Fragment,
        null,
        createElement(AxisMotionEditLockSync),
        createElement(
          ProjectStoreProvider,
          null,
          createElement(ProgramProvider, null, createElement(ActionBuilderProvider, null, children)),
        ),
      ),
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

const savedSequences = (result: Rendered) =>
  result.current.project.currentProject!.document!.motion.actionSequences;

const createDraft = (result: Rendered) => {
  act(() => result.current.builder.handleCreateSequence([]));
  act(() => {
    result.current.builder.handleInsertTimelineBlock(pose("a", 7, 1000, 0));
    result.current.builder.handleInsertTimelineBlock(pose("b", 7, 11_000, 100));
  });
  return result.current.builder.selectedSequenceId!;
};

describe("action builder while axes move", () => {
  beforeEach(() => {
    Object.values(toast).forEach((spy) => spy.mockClear());
    installMemoryProjectAPI();
    stubCsocket();
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
    delete (window as unknown as { csocketApi?: unknown }).csocketApi;
  });

  it("keeps editing the draft but does not save it until the axes stop", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    const id = createDraft(result);

    setAxisMoving(true);
    act(() => result.current.builder.handleInsertTimelineBlock(pose("c", 7, 20_000, 50)));
    expect(result.current.builder.sequence!.blocks.map((block) => block.id)).toEqual(["a", "b", "c"]);

    act(() => result.current.builder.handleSave());
    expect(toast.warning).toHaveBeenCalledWith(LOCK);
    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.builder.draftSequenceIds.has(id)).toBe(true);
    expect(savedSequences(result).find((item) => item.id === id)!.blocks).toEqual([]);

    let saveAll: ReturnType<typeof result.current.builder.handleSaveAll> | undefined;
    act(() => {
      saveAll = result.current.builder.handleSaveAll();
    });
    expect(saveAll).toEqual({ saved: 0, blocked: [] });
    expect(result.current.builder.draftSequenceIds.has(id)).toBe(true);

    setAxisMoving(false);
    act(() => result.current.builder.handleSave());
    expect(result.current.builder.draftSequenceIds.has(id)).toBe(false);
    expect(savedSequences(result).find((item) => item.id === id)!.blocks.map((block) => block.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("does not create, rename or delete sequences while axes move", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    act(() => result.current.builder.handleCreateSequence([]));
    const id = result.current.builder.selectedSequenceId!;
    const name = savedSequences(result).find((item) => item.id === id)!.name;
    const count = savedSequences(result).length;

    setAxisMoving(true);
    act(() => result.current.builder.handleCreateSequence([]));
    expect(savedSequences(result)).toHaveLength(count);

    let renameError: string | null = null;
    act(() => {
      renameError = result.current.builder.handleRenameSequence("新名字", id);
    });
    expect(renameError).toBe(LOCK);
    expect(savedSequences(result).find((item) => item.id === id)!.name).toBe(name);

    act(() => result.current.builder.handleDeleteSequence());
    expect(savedSequences(result).some((item) => item.id === id)).toBe(true);

    setAxisMoving(false);
    act(() => {
      renameError = result.current.builder.handleRenameSequence("新名字", id);
    });
    expect(renameError).toBeNull();
    expect(savedSequences(result).find((item) => item.id === id)!.name).toBe("新名字");
  });
});
