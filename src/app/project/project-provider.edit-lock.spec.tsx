// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDocument } from "./project-document-types";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "./install-memory-project-api";
import { ProjectProvider } from "./project-provider";
import { GZ_2025_RECORD } from "./test-fixtures";
import { useProject } from "./use-project";

const toast = vi.hoisted(() => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const LOCK = "2 个轴运动中，搭建暂时只读";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(ProjectProvider, null, children);

const renderProject = async () => {
  const rendered = renderHook(() => useProject(), { wrapper });
  const { result } = rendered;
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.openProject(GZ_2025_RECORD.folderName);
  });
  await waitFor(() => expect(result.current.currentProject?.document).toBeTruthy());
  return rendered;
};

const withGroup = (name: string) => (document: ProjectDocument): ProjectDocument => ({
  ...document,
  setup: {
    ...document.setup,
    scene: { groups: [{ id: `group-${name}`, name, objectIds: [] }] },
  },
});

const withSequence = (id: number) => (document: ProjectDocument): ProjectDocument => ({
  ...document,
  motion: {
    ...document.motion,
    actionSequences: [
      ...document.motion.actionSequences,
      { id, name: `序列${id}`, trajectoryMode: false, blocks: [], segments: [] },
    ],
  },
});

describe("ProjectProvider edit lock", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    installMemoryProjectAPI();
    window.csocketApi = {
      openProject: async () => ({ ok: true as const, data: { success: true } }),
    } as unknown as Window["csocketApi"];
    toast.warning.mockClear();
  });

  afterEach(() => {
    cleanup();
    uninstallMemoryProjectAPI();
    delete (window as unknown as { csocketApi?: unknown }).csocketApi;
  });

  it("refuses setup changes while locked and tells why, then accepts them once unlocked", async () => {
    const { result } = await renderProject();
    const before = result.current.currentProject!.document!.setup;

    act(() => result.current.setSetupEditLock(LOCK));
    let outcome: ReturnType<typeof result.current.runTrackedDocumentUpdate> | undefined;
    act(() => {
      outcome = result.current.runTrackedDocumentUpdate("改分组", withGroup("a"));
    });
    expect(outcome).toEqual({ ok: false, changed: false, reason: LOCK });
    expect(result.current.currentProject!.document!.setup).toBe(before);
    expect(toast.warning).toHaveBeenCalledWith(LOCK, expect.objectContaining({ id: expect.any(String) }));

    // 没有实际改动的照常放行（如只改本地选中）
    act(() => {
      outcome = result.current.runTrackedDocumentUpdate("无改动", (document) => document);
    });
    expect(outcome).toEqual({ ok: true, changed: false });

    act(() => result.current.setSetupEditLock(null));
    act(() => {
      outcome = result.current.runTrackedDocumentUpdate("改分组", withGroup("a"));
    });
    expect(outcome).toEqual({ ok: true, changed: true });
  });

  it("does not start a drag edit while locked and rolls back one that gets locked midway", async () => {
    const { result } = await renderProject();
    const before = result.current.currentProject!.document!.setup;

    act(() => result.current.setSetupEditLock(LOCK));
    act(() => {
      expect(result.current.beginTrackedEdit("drag", "移动")).toBe(false);
    });
    act(() => result.current.setSetupEditLock(null));

    act(() => {
      expect(result.current.beginTrackedEdit("drag", "移动")).toBe(true);
      result.current.runTrackedDocumentUpdate("移动", withGroup("预览"));
    });
    expect(result.current.currentProject!.document!.setup).not.toBe(before);

    act(() => result.current.setSetupEditLock(LOCK));
    let committed: ReturnType<typeof result.current.commitTrackedEdit> | undefined;
    act(() => {
      committed = result.current.commitTrackedEdit("drag");
    });
    expect(committed).toEqual({ ok: false, changed: false, reason: LOCK });
    expect(result.current.isTrackedEditActive).toBe(false);
    expect(result.current.currentProject!.document!.setup.scene).toEqual(before.scene);
    expect(result.current.canUndo).toBe(false);
  });

  it("blocks setup undo and redo while locked", async () => {
    const { result } = await renderProject();
    act(() => {
      result.current.runTrackedDocumentUpdate("改分组", withGroup("a"));
    });
    const changed = result.current.currentProject!.document!.setup;

    act(() => result.current.setSetupEditLock(LOCK));
    let undone: ReturnType<typeof result.current.undoProjectConfiguration> | undefined;
    act(() => {
      undone = result.current.undoProjectConfiguration();
    });
    expect(undone).toEqual({ ok: false, changed: false, reason: LOCK });
    expect(result.current.currentProject!.document!.setup).toBe(changed);
  });

  it("refuses to change or delete a running action's sequence, and only that one", async () => {
    const { result } = await renderProject();
    act(() => {
      result.current.updateCurrentDocument(withSequence(9001), "motion");
      result.current.updateCurrentDocument(withSequence(9002), "motion");
    });
    const sequences = () => result.current.currentProject!.document!.motion.actionSequences;
    // 动作编辑写入工程时整体复制序列
    const mapSequences =
      (map: (items: ProjectDocument["motion"]["actionSequences"]) => ProjectDocument["motion"]["actionSequences"]) =>
      (document: ProjectDocument): ProjectDocument => ({
        ...document,
        motion: { ...document.motion, actionSequences: map(structuredClone(document.motion.actionSequences)) },
      });
    const rename = (id: number, name: string) =>
      mapSequences((items) => items.map((item) => (item.id === id ? { ...item, name } : item)));
    const remove = (id: number) => mapSequences((items) => items.filter((item) => item.id !== id));

    act(() => result.current.setRunningSequenceIds(new Set([9001])));
    let outcome: ReturnType<typeof result.current.updateCurrentDocument> | undefined;
    act(() => {
      outcome = result.current.updateCurrentDocument(rename(9001, "改名"), "motion");
    });
    expect(outcome).toEqual({ ok: false, changed: false, reason: "「序列9001」正在运行，停下后再修改" });
    act(() => {
      outcome = result.current.updateCurrentDocument(remove(9001), "ai");
    });
    expect(outcome?.ok).toBe(false);
    expect(sequences().find((item) => item.id === 9001)?.name).toBe("序列9001");

    // 别的序列、新建序列照常
    act(() => {
      outcome = result.current.updateCurrentDocument(rename(9002, "改名"), "motion");
    });
    expect(outcome).toEqual({ ok: true, changed: true });
    act(() => {
      outcome = result.current.updateCurrentDocument(withSequence(9003), "ai");
    });
    expect(outcome).toEqual({ ok: true, changed: true });

    // 控制页的节目操作不拦
    act(() => {
      outcome = result.current.updateCurrentDocument(remove(9001), "program");
    });
    expect(outcome).toEqual({ ok: true, changed: true });
  });
});
