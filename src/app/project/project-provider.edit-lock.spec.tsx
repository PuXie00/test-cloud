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
const ACTION_LOCK = "2 个轴运动中，动作暂时不能保存";

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

    act(() => result.current.setEditLock("setup", LOCK));
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

    act(() => result.current.setEditLock("setup", null));
    act(() => {
      outcome = result.current.runTrackedDocumentUpdate("改分组", withGroup("a"));
    });
    expect(outcome).toEqual({ ok: true, changed: true });
  });

  it("does not start a drag edit while locked and rolls back one that gets locked midway", async () => {
    const { result } = await renderProject();
    const before = result.current.currentProject!.document!.setup;

    act(() => result.current.setEditLock("setup", LOCK));
    act(() => {
      expect(result.current.beginTrackedEdit("drag", "移动")).toBe(false);
    });
    act(() => result.current.setEditLock("setup", null));

    act(() => {
      expect(result.current.beginTrackedEdit("drag", "移动")).toBe(true);
      result.current.runTrackedDocumentUpdate("移动", withGroup("预览"));
    });
    expect(result.current.currentProject!.document!.setup).not.toBe(before);

    act(() => result.current.setEditLock("setup", LOCK));
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

    act(() => result.current.setEditLock("setup", LOCK));
    let undone: ReturnType<typeof result.current.undoProjectConfiguration> | undefined;
    act(() => {
      undone = result.current.undoProjectConfiguration();
    });
    expect(undone).toEqual({ ok: false, changed: false, reason: LOCK });
    expect(result.current.currentProject!.document!.setup).toBe(changed);
  });

  it("blocks action-sequence writes from the editor and AI, not the control page program", async () => {
    const { result } = await renderProject();
    const sequences = () => result.current.currentProject!.document!.motion.actionSequences;
    const count = sequences().length;

    act(() => result.current.setEditLock("motion", ACTION_LOCK));
    let outcome: ReturnType<typeof result.current.updateCurrentDocument> | undefined;
    act(() => {
      outcome = result.current.updateCurrentDocument(withSequence(9001), "motion");
    });
    expect(outcome).toEqual({ ok: false, changed: false, reason: ACTION_LOCK });
    act(() => {
      outcome = result.current.updateCurrentDocument(withSequence(9002), "ai");
    });
    expect(outcome?.ok).toBe(false);
    expect(sequences()).toHaveLength(count);

    act(() => {
      outcome = result.current.updateCurrentDocument(withSequence(9003), "program");
    });
    expect(outcome).toEqual({ ok: true, changed: true });

    // 动作锁不影响搭建
    act(() => {
      outcome = result.current.runTrackedDocumentUpdate("改分组", withGroup("b"));
    });
    expect(outcome).toEqual({ ok: true, changed: true });
  });
});
