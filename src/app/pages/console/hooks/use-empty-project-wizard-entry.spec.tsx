// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestPermissionsProvider } from "@/app/auth/permissions";
import type { PermissionId } from "@shared/auth/permissions";
import { useEmptyProjectWizardEntry } from "./use-empty-project-wizard-entry";

type MockProject = {
  id: string;
  document: { setup: { controlledObjects: unknown[]; plcs: unknown[]; motors: unknown[] } };
} | null;

let currentProject: MockProject = null;

vi.mock("@/app/project/use-project", () => ({
  useProject: () => ({ currentProject }),
}));

const project = (id: string, objectCount = 0): MockProject => ({
  id,
  document: {
    setup: { controlledObjects: Array.from({ length: objectCount }), plcs: [], motors: [] },
  },
});

const renderEntry = (
  options: { isShow?: boolean; permissions?: PermissionId[] } = {},
) => {
  const onEnter = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestPermissionsProvider permissions={options.permissions ?? ["build.view", "build.edit"]}>
      {children}
    </TestPermissionsProvider>
  );
  const view = renderHook(
    () => useEmptyProjectWizardEntry({ isShow: options.isShow ?? false, onEnter }),
    { wrapper },
  );
  return { onEnter, rerender: view.rerender };
};

beforeEach(() => {
  currentProject = null;
});

afterEach(() => cleanup());

describe("打开空工程时进入配置向导", () => {
  it("空工程进入一次，之后重新渲染不再跳转", () => {
    currentProject = project("a");
    const { onEnter, rerender } = renderEntry();
    rerender();
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("有内容的工程不跳转", () => {
    currentProject = project("a", 1);
    const { onEnter } = renderEntry();
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("同一工程加了内容又删光不会再次跳转", () => {
    currentProject = project("a", 1);
    const { onEnter, rerender } = renderEntry();
    currentProject = project("a");
    rerender();
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("切换到另一个空工程时再次进入", () => {
    currentProject = project("a");
    const { onEnter, rerender } = renderEntry();
    currentProject = project("b");
    rerender();
    expect(onEnter).toHaveBeenCalledTimes(2);
  });

  it("没有工程时不跳转", () => {
    const { onEnter } = renderEntry();
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("演出模式不跳转", () => {
    currentProject = project("a");
    const { onEnter } = renderEntry({ isShow: true });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("没有编辑权限不跳转", () => {
    currentProject = project("a");
    const { onEnter } = renderEntry({ permissions: ["build.view"] });
    expect(onEnter).not.toHaveBeenCalled();
  });
});
