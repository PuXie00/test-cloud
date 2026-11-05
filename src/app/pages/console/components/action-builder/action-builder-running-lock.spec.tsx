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
import { ActionRunEditLockSync, ActionRunProvider } from "@/app/pages/console/hooks/action-run";
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

let emitAct: (msg: unknown) => void = () => undefined;

const stubCsocket = () => {
  const ok = async () => ({ ok: true as const, data: { success: true as const } });
  window.csocketApi = {
    openProject: ok,
    addModelWithDefaultValues: ok,
    modifyModelType: ok,
    configureModelParamModel: ok,
    deleteModelPlc: ok,
    onReadActionRun: (cb: (msg: unknown) => void) => {
      emitAct = cb;
      return () => undefined;
    },
  } as unknown as Window["csocketApi"];
};

/** PLC 只上报正在执行的动作；不再上报超过 1 秒就算停了 */
const reportRunning = (actionId: number) =>
  act(() =>
    emitAct({ success: true, data: [{ actionId, state: 3, loopCount: 1, loopCountSet: 1, runTime: 10 }] }),
  );

const letActionsStop = () =>
  act(() => {
    vi.advanceTimersByTime(1500);
  });

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    ProjectProvider,
    null,
    createElement(
      ActionRunProvider,
      null,
      createElement(
        Fragment,
        null,
        createElement(ActionRunEditLockSync),
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

const saved = (result: Rendered, id: number) =>
  result.current.project.currentProject!.document!.motion.actionSequences.find((item) => item.id === id);

/** 新建一条带两个位姿的序列，返回 id（草稿未保存） */
const createDraft = (result: Rendered, prefix: string) => {
  act(() => result.current.builder.handleCreateSequence([]));
  act(() => {
    result.current.builder.handleInsertTimelineBlock(pose(`${prefix}a`, 7, 1000, 0));
    result.current.builder.handleInsertTimelineBlock(pose(`${prefix}b`, 7, 11_000, 100));
  });
  return result.current.builder.selectedSequenceId!;
};

describe("action builder while the sequence's action is running", () => {
  beforeEach(() => {
    Object.values(toast).forEach((spy) => spy.mockClear());
    installMemoryProjectAPI();
    stubCsocket();
  });

  afterEach(() => {
    vi.useRealTimers();
    uninstallMemoryProjectAPI();
    delete (window as unknown as { csocketApi?: unknown }).csocketApi;
  });

  it("does not save a running action's draft until it stops, and saves the others", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    const running = createDraft(result, "r");
    const other = createDraft(result, "o");
    const runningName = saved(result, running)!.name;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });

    reportRunning(running);
    act(() => result.current.builder.handleSequenceSelect(running));
    act(() => result.current.builder.handleSave());
    expect(toast.warning).toHaveBeenCalledWith(`「${runningName}」正在运行，停下后再保存`);
    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.builder.draftSequenceIds.has(running)).toBe(true);
    expect(saved(result, running)!.blocks).toEqual([]);

    let saveAll: ReturnType<typeof result.current.builder.handleSaveAll> | undefined;
    act(() => {
      saveAll = result.current.builder.handleSaveAll();
    });
    expect(saveAll).toEqual({ saved: 1, blocked: [], running: [runningName] });
    expect(saved(result, other)!.blocks).toHaveLength(2);
    expect(result.current.builder.draftSequenceIds.has(running)).toBe(true);

    letActionsStop();
    act(() => result.current.builder.handleSave());
    expect(result.current.builder.draftSequenceIds.has(running)).toBe(false);
    expect(saved(result, running)!.blocks).toHaveLength(2);
  });

  it("does not rename or delete a running action's sequence; new sequences are fine", async () => {
    const { result } = renderBuilder();
    await openFixtureProject(result);
    act(() => result.current.builder.handleCreateSequence([]));
    const id = result.current.builder.selectedSequenceId!;
    const name = saved(result, id)!.name;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    reportRunning(id);

    let renameError: string | null = null;
    act(() => {
      renameError = result.current.builder.handleRenameSequence("新名字", id);
    });
    expect(renameError).toBe(`「${name}」正在运行，停下后再改名`);

    act(() => result.current.builder.handleDeleteSequence());
    expect(toast.warning).toHaveBeenCalledWith(`「${name}」正在运行，停下后再删除`);
    expect(saved(result, id)).toBeTruthy();

    const count = result.current.project.currentProject!.document!.motion.actionSequences.length;
    act(() => result.current.builder.handleCreateSequence([]));
    expect(result.current.project.currentProject!.document!.motion.actionSequences).toHaveLength(count + 1);

    letActionsStop();
    act(() => {
      renameError = result.current.builder.handleRenameSequence("新名字", id);
    });
    expect(renameError).toBeNull();
    expect(saved(result, id)!.name).toBe("新名字");
  });
});
