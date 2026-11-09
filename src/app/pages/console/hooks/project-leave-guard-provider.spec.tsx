// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveAllResult } from "../components/action-builder/action-builder-context-types";
import {
  ProjectLeaveGuardProvider,
  useConfirmProjectLeave,
  type ConfirmProjectLeave,
} from "./project-leave-guard-provider";

const state = vi.hoisted(() => ({
  isDirty: true,
  draftIds: new Set<number>(),
  canSave: true,
  saveOk: true,
  saveAll: { saved: 1, blocked: [], running: [] } as SaveAllResult,
}));
const saveProject = vi.hoisted(() => vi.fn(async () => state.saveOk));
const handleSaveAll = vi.hoisted(() => vi.fn(() => state.saveAll));

vi.mock("@/app/project/use-project", () => ({
  useProject: () => ({
    currentProject: { name: "演唱会", document: {} },
    isDirty: state.isDirty,
  }),
}));
vi.mock("@/app/project/project-motion-readiness", () => ({
  getSequenceContentRepairIssue: () => null,
}));
vi.mock("@/app/auth/permissions", () => ({
  usePermissions: () => ({ can: () => state.canSave }),
}));
vi.mock("./use-save-project", () => ({ useSaveProject: () => saveProject }));
vi.mock("../components/action-builder/use-action-builder", () => ({
  useActionBuilder: () => ({
    sequences: [{ id: 1, name: "开场" }],
    draftSequenceIds: state.draftIds,
    handleSaveAll,
  }),
}));

let confirmLeave: ConfirmProjectLeave = async () => false;
const Probe = () => {
  confirmLeave = useConfirmProjectLeave();
  return null;
};

const renderGuard = () =>
  render(
    <ProjectLeaveGuardProvider>
      <Probe />
    </ProjectLeaveGuardProvider>,
  );

const ask = (reason: Parameters<ConfirmProjectLeave>[0] = "manage") => {
  let result!: Promise<boolean>;
  act(() => {
    result = confirmLeave(reason);
  });
  return result;
};

describe("ProjectLeaveGuardProvider", () => {
  beforeEach(() => {
    state.isDirty = true;
    state.draftIds = new Set();
    state.canSave = true;
    state.saveOk = true;
    state.saveAll = { saved: 1, blocked: [], running: [] };
    saveProject.mockClear();
    handleSaveAll.mockClear();
  });
  afterEach(() => {
    cleanup();
    delete (window as { toolAPI?: unknown }).toolAPI;
  });

  it("lets the user leave right away when nothing is unsaved", async () => {
    state.isDirty = false;
    renderGuard();
    await expect(ask()).resolves.toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before leaving a project with unsaved changes", async () => {
    renderGuard();
    const cancelled = ask("close");
    expect(screen.getByRole("alertdialog").textContent).toContain("关闭工程前保存修改吗？");
    expect(screen.getByRole("alertdialog").textContent).toContain("工程「演唱会」有未保存的修改");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await expect(cancelled).resolves.toBe(false);

    const discarded = ask();
    expect(screen.getByRole("alertdialog").textContent).toContain("进入工程管理前保存修改吗？");
    fireEvent.click(screen.getByRole("button", { name: "不保存" }));
    await expect(discarded).resolves.toBe(true);
    expect(saveProject).not.toHaveBeenCalled();
  });

  it("saves the action drafts and the project file before leaving", async () => {
    state.draftIds = new Set([1]);
    renderGuard();
    const result = ask();
    expect(screen.getByRole("alertdialog").textContent).toContain("动作序列「开场」还没保存");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await expect(result).resolves.toBe(true);
    expect(handleSaveAll).toHaveBeenCalledTimes(1);
    expect(saveProject).toHaveBeenCalledTimes(1);
  });

  it("stays when saving fails, and offers no save without the permission", async () => {
    state.saveOk = false;
    renderGuard();
    const result = ask();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alertdialog")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await expect(result).resolves.toBe(false);
    cleanup();

    state.canSave = false;
    renderGuard();
    void ask();
    expect(screen.getByRole("button", { name: "保存" }).hasAttribute("disabled")).toBe(true);
  });

  it("holds the window close button while there are unsaved changes", async () => {
    let requestClose: (() => void) | undefined;
    const toolAPI = {
      confirm: vi.fn(),
      setCloseGuard: vi.fn(),
      onCloseRequest: vi.fn((listener: () => void) => {
        requestClose = listener;
        return () => {
          requestClose = undefined;
        };
      }),
      confirmClose: vi.fn(),
    };
    (window as { toolAPI?: unknown }).toolAPI = toolAPI;
    const view = renderGuard();
    expect(toolAPI.setCloseGuard).toHaveBeenLastCalledWith(true);

    act(() => requestClose?.());
    expect(screen.getByRole("alertdialog").textContent).toContain("退出前保存修改吗？");
    fireEvent.click(screen.getByRole("button", { name: "不保存" }));
    await waitFor(() => expect(toolAPI.confirmClose).toHaveBeenCalledTimes(1));

    view.unmount();
    expect(toolAPI.setCloseGuard).toHaveBeenLastCalledWith(false);
    expect(requestClose).toBeUndefined();
  });
});
