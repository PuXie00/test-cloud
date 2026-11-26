// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveAllResult } from "../components/action-builder/action-builder-context-types";
import type { ExecCard } from "./use-exec-cards";
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
  cards: [] as ExecCard[],
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
vi.mock("./use-exec-cards", () => ({ useExecCards: () => ({ cards: state.cards }) }));

const execCard = (overrides: Partial<ExecCard>): ExecCard => ({
  id: "card",
  kind: "sequence",
  name: "开场",
  source: { kind: "fader", slotIndex: 0, itemKey: "c1#0#1" },
  durationMs: null,
  elapsedMs: 0,
  speedPercent: 100,
  status: "running",
  startedAt: 0,
  emergencyStopped: false,
  ...overrides,
});

const fakeToolAPI = () => {
  const api = {
    requestClose: undefined as (() => void) | undefined,
    confirm: vi.fn(),
    setCloseGuard: vi.fn(),
    onCloseRequest: vi.fn((listener: () => void) => {
      api.requestClose = listener;
      return () => {
        api.requestClose = undefined;
      };
    }),
    confirmClose: vi.fn(),
  };
  (window as { toolAPI?: unknown }).toolAPI = api;
  return api;
};
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
    state.cards = [];
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

  describe("while an action this machine started is running", () => {
    it("refuses to quit, close or switch project and says to stop first, without asking to save", async () => {
      state.cards = [execCard({ name: "开场" }), execCard({ id: "b", name: "谢幕", status: "paused" })];
      renderGuard();
      await expect(ask("close")).resolves.toBe(false);
      const dialog = screen.getByRole("alertdialog");
      expect(dialog.textContent).toContain("有动作正在运行");
      expect(dialog.textContent).toContain("「开场」「谢幕」正在运行，请先停止再关闭工程。");
      expect(dialog.textContent).not.toContain("保存修改吗");
      fireEvent.click(screen.getByRole("button", { name: "知道了" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

      await expect(ask("manage")).resolves.toBe(false);
      expect(screen.getByRole("alertdialog").textContent).toContain("请先停止再进入工程管理");
    });

    it("waits for a stopping action to settle", async () => {
      state.isDirty = false;
      state.cards = [execCard({ name: "开场", status: "stopping" })];
      renderGuard();
      await expect(ask("quit")).resolves.toBe(false);
      expect(screen.getByRole("alertdialog").textContent).toContain("「开场」正在停止，停稳后再退出。");
    });

    it("ignores external and finished runs", async () => {
      state.isDirty = false;
      state.cards = [
        execCard({ name: "外部的", source: { kind: "external" } }),
        execCard({ id: "b", name: "已结束", status: "completed" }),
      ];
      renderGuard();
      await expect(ask("quit")).resolves.toBe(true);
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("holds the window close button even with nothing unsaved, and never confirms the close", async () => {
      state.isDirty = false;
      state.cards = [execCard({ name: "开场" })];
      const toolAPI = fakeToolAPI();
      const view = renderGuard();
      expect(toolAPI.setCloseGuard).toHaveBeenLastCalledWith(true);

      act(() => toolAPI.requestClose?.());
      expect(screen.getByRole("alertdialog").textContent).toContain("「开场」正在运行，请先停止再退出。");
      fireEvent.click(screen.getByRole("button", { name: "知道了" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(toolAPI.confirmClose).not.toHaveBeenCalled();

      // 停下来之后不再拦 ✕
      state.cards = [execCard({ name: "开场", status: "stopped" })];
      view.rerender(
        <ProjectLeaveGuardProvider>
          <Probe />
        </ProjectLeaveGuardProvider>,
      );
      expect(toolAPI.setCloseGuard).toHaveBeenLastCalledWith(false);
    });
  });
});
