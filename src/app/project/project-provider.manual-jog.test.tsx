// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "./install-memory-project-api";
import { ProjectProvider } from "./project-provider";
import { GZ_2025_RECORD } from "./test-fixtures";
import { useProject } from "./use-project";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(ProjectProvider, null, children);

describe("persistManualJog", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    installMemoryProjectAPI();
    window.csocketApi = {
      openProject: async () => ({ ok: true as const, data: { success: true } }),
    } as Window["csocketApi"];
  });
  afterEach(() => {
    cleanup();
    uninstallMemoryProjectAPI();
  });

  it("persists without pushing history or writing cover", async () => {
    const { result } = renderHook(() => useProject(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.openProject(GZ_2025_RECORD.folderName);
    });
    await waitFor(() => expect(result.current.currentProject?.document).toBeTruthy());

    // 先做一次普通编辑，制造一条撤销历史
    act(() => {
      result.current.runTrackedDocumentUpdate("测试场景", (doc) => ({
        ...doc,
        setup: { ...doc.setup, scene: { groups: [] } },
      }));
    });
    expect(result.current.canUndo).toBe(true);

    await act(async () => {
      await result.current.persistManualJog({ v1: { velocity: 42, accelDecelTime: 3 } });
    });

    expect(result.current.currentProject?.document.setup.manualJog).toEqual({
      v1: { velocity: 42, accelDecelTime: 3 },
      v2: { velocity: 5, accelDecelTime: 2 },
      v3: { velocity: 5, accelDecelTime: 2 },
    });
    // 撤销栈未增长（仍只有 1 条，来自上面的普通编辑）
    expect(result.current.canUndo).toBe(true);
    expect(result.current.isDirty).toBe(false);
    // 内存 projectAPI 仅在显式传 coverPngBase64 时置 hasCover
    expect(result.current.currentProject?.hasCover).toBeFalsy();
  });
});
