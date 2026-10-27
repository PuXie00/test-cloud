// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import type { PermissionId } from "@shared/auth/permissions";
import { TestPermissionsProvider } from "@/app/auth/permissions";
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

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

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

const permissionsRef: { current: PermissionId[] } = { current: [] };

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    TestPermissionsProvider,
    { permissions: permissionsRef.current },
    createElement(
      ProjectProvider,
      null,
      createElement(
        ProjectStoreProvider,
        null,
        createElement(ProgramProvider, null, createElement(ActionBuilderProvider, null, children)),
      ),
    ),
  );

const renderBuilder = async (permissions: PermissionId[]) => {
  permissionsRef.current = permissions;
  const rendered = renderHook(() => ({ builder: useActionBuilder(), project: useProject() }), { wrapper });
  const { result } = rendered;
  await waitFor(() => expect(result.current.project.loading).toBe(false));
  await act(async () => {
    await result.current.project.openProject(GZ_2025_RECORD.folderName);
  });
  await waitFor(() => expect(result.current.project.currentProject?.document).toBeTruthy());
  return result;
};

const sequenceCount = (result: Awaited<ReturnType<typeof renderBuilder>>) =>
  result.current.project.currentProject!.document!.motion.actionSequences.length;

describe("动作编辑的权限总闸", () => {
  beforeEach(() => {
    Object.values(toast).forEach((spy) => spy.mockClear());
    installMemoryProjectAPI();
    stubCsocketOpenProject();
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
    delete window.csocketApi;
  });

  it("只有「进入动作页」：直接调用新建序列也改不了工程", async () => {
    const result = await renderBuilder(["action.view"]);
    const before = sequenceCount(result);
    act(() => result.current.builder.handleCreateSequence([]));
    expect(sequenceCount(result)).toBe(before);
    expect(toast.error).toHaveBeenCalledWith("没有「编辑动作序列」权限", expect.anything());
  });

  it("只有「进入动作页」：新建章节被拦下", async () => {
    const result = await renderBuilder(["action.view"]);
    const programs = result.current.builder.programs;
    act(() => result.current.builder.handleChapterAdd());
    expect(result.current.builder.programs).toBe(programs);
  });

  it("有「编辑动作序列」照常新建", async () => {
    const result = await renderBuilder(["action.view", "action.edit"]);
    const before = sequenceCount(result);
    act(() => result.current.builder.handleCreateSequence([]));
    expect(sequenceCount(result)).toBe(before + 1);
  });
});
