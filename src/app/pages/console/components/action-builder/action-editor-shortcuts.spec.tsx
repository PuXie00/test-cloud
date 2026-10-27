// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { ProjectProvider } from "@/app/project/project-provider";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "@/app/project/install-memory-project-api";
import type { TimelineBlock } from "@/app/project/action-sequence/types";
import { GZ_2025_RECORD } from "@/app/project/test-fixtures";
import { useProject } from "@/app/project/use-project";
import { ProgramProvider } from "@/app/pages/console/hooks/use-program";
import { ProjectStoreProvider } from "@/app/pages/console/hooks/use-project-store";
import { ConsoleNavProvider } from "@/app/pages/console/hooks/use-console-nav";
import { ConsoleLoginProvider } from "@/app/pages/console/components/login-overlay/console-login-context";
import type { LeftNavId } from "@/app/pages/console/components/LeftSidebar";
import type { ActionBuilderContextValue } from "./action-builder-context-types";
import { ActionBuilderProvider } from "./action-builder-context";
import { useActionBuilder } from "./use-action-builder";

const { consoleMode } = vi.hoisted(() => ({
  consoleMode: { current: "rehearsal" as "rehearsal" | "show" },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/app/auth/use-auth", () => ({
  useAuth: () => ({ user: { role: "admin" }, logout: vi.fn() }),
}));
vi.mock("@/app/pages/console/hooks/use-console-mode", () => ({
  useConsoleMode: () => ({
    mode: consoleMode.current,
    isLocked: false,
    enterShow: vi.fn(),
    exitShow: vi.fn(),
    lock: vi.fn(),
  }),
}));
vi.mock("@/app/pages/console/hooks/plc-runtime-provider", () => ({
  usePlcRuntime: () => ({
    shouldShowMismatchDialog: false,
    markMismatchDialogConsumed: vi.fn(),
    systemStatus: { kind: "normal" },
  }),
}));
vi.mock(
  "@/app/pages/console/components/drive-debug/alignment-checklist/alignment-checklist-provider",
  () => ({
    useAlignmentChecklist: () => ({ allConfirmed: true, openDialog: vi.fn(), dialogOpen: false }),
  }),
);
vi.mock("@/app/components/ics/emergency-stop-button", () => ({ EmergencyStopButton: () => null }));
vi.mock("@/app/components/project-center", () => ({ ProjectCenterDialog: () => null }));
vi.mock("@/app/components/project-center/new-project-dialog", () => ({ NewProjectDialog: () => null }));
vi.mock("@/app/pages/console/components/show-mode-confirm/show-mode-confirm-dialog", () => ({
  ShowModeConfirmDialog: () => null,
}));
vi.mock("@/app/pages/console/components/system-status/project-mismatch-dialog", () => ({
  ProjectMismatchDialog: () => null,
}));
vi.mock("@/app/pages/console/components/collaboration/collab-dialog", () => ({ CollabDialog: () => null }));
vi.mock("@/app/pages/console/components/collaboration/collab-quick-popover", () => ({
  CollabQuickPopover: () => null,
}));
vi.mock("@/app/pages/console/components/operation-log/operation-log-dialog", () => ({
  OperationLogDialog: () => null,
}));
vi.mock("@/app/pages/console/components/permissions/permissions-dialog", () => ({
  PermissionsDialog: () => null,
}));
vi.mock("@/app/pages/console/components/system-settings/system-settings-dialog", () => ({
  SystemSettingsDialog: () => null,
}));
vi.mock(
  "@/app/pages/console/components/drive-debug/alignment-checklist/alignment-checklist-dialog",
  () => ({ AlignmentChecklistDialog: () => null }),
);
vi.mock("@/app/pages/console/components/system-status/system-status-popover", () => ({
  SystemStatusPopover: () => null,
}));
vi.mock("@/app/viz3d", () => ({
  getViz3DEngine: () => ({ getSavedView: () => null, captureCoverPngBase64: () => null }),
}));

import { TopBar } from "@/app/pages/console/components/TopBar";

const stubCsocket = () => {
  const ok = async () => ({ ok: true as const, data: { success: true as const } });
  window.csocketApi = new Proxy({}, { get: () => ok }) as unknown as Window["csocketApi"];
};

type Handles = {
  builder: ActionBuilderContextValue;
  project: ReturnType<typeof useProject>;
  setNav: (id: LeftNavId) => void;
};

const handles: { current: Partial<Handles> } = { current: {} };

const Probe = () => {
  handles.current.builder = useActionBuilder();
  handles.current.project = useProject();
  return null;
};

const NavHost = ({ children }: { children: ReactNode }) => {
  const [activeNav, setActiveNav] = useState<LeftNavId>("sequences");
  handles.current.setNav = setActiveNav;
  return (
    <ConsoleNavProvider activeNav={activeNav} navigate={setActiveNav}>
      {children}
    </ConsoleNavProvider>
  );
};

const renderConsole = () =>
  render(
    <ProjectProvider>
      <ProjectStoreProvider>
        <ProgramProvider>
          <ActionBuilderProvider>
            <NavHost>
              <ConsoleLoginProvider>
                <TopBar onStop={vi.fn()} />
              </ConsoleLoginProvider>
              <input aria-label="名字输入框" />
              <Probe />
            </NavHost>
          </ActionBuilderProvider>
        </ProgramProvider>
      </ProjectStoreProvider>
    </ProjectProvider>,
  );

const builder = () => handles.current.builder!;
const project = () => handles.current.project!;
const blockIds = () => builder().sequence?.blocks.map((block) => block.id);
const objectName = (id: number) =>
  project().currentProject!.document!.setup.controlledObjects.find((object) => object.id === id)!.name;

const pose = (id: string, atMs: number): TimelineBlock => ({
  id,
  kind: "pose",
  objectId: 7,
  atMs,
  pose: { v1: 0, v2: 0, v3: 0 },
});

/** 打开工程，在编辑器里新建序列放两个位姿，再做一次搭建修改（给物体 7 改名） */
const prepare = async () => {
  await waitFor(() => expect(handles.current.project?.loading).toBe(false));
  await act(async () => {
    await project().openProject(GZ_2025_RECORD.folderName);
  });
  await waitFor(() => expect(project().currentProject?.document).toBeTruthy());
  act(() => builder().handleCreateSequence([]));
  act(() => builder().handleInsertTimelineBlock(pose("a", 1000)));
  act(() => builder().handleInsertTimelineBlock(pose("b", 3000)));
  act(() => {
    const result = project().runTrackedDocumentUpdate(
      "改名",
      (doc) => ({
        ...doc,
        setup: {
          ...doc.setup,
          controlledObjects: doc.setup.controlledObjects.map((object) =>
            object.id === 7 ? { ...object, name: "改过的名字" } : object,
          ),
        },
      }),
      "setup",
    );
    expect(result.ok).toBe(true);
  });
  expect(project().canUndo).toBe(true);
  expect(builder().canUndoEdit).toBe(true);
};

/** 按下快捷键，返回是否被拦下（拦下 = 应用处理了，浏览器默认行为不执行） */
const press = (init: KeyboardEventInit, target: Element | Window = window) =>
  !fireEvent.keyDown(target, { key: "z", ...init });

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
});

describe("Ctrl+Z / Ctrl+Y on the action editor page", () => {
  beforeEach(() => {
    consoleMode.current = "rehearsal";
    installMemoryProjectAPI();
    stubCsocket();
  });

  afterEach(() => {
    cleanup();
    uninstallMemoryProjectAPI();
    delete window.csocketApi;
    handles.current = {};
  });

  it("Ctrl+Z undoes the editor, Ctrl+Y and Ctrl+Shift+Z redo it, and 搭建 is untouched", async () => {
    renderConsole();
    await prepare();

    expect(press({ ctrlKey: true })).toBe(true);
    expect(blockIds()).toEqual(["a"]);
    expect(press({ ctrlKey: true })).toBe(true);
    expect(blockIds()).toEqual([]);

    expect(press({ key: "y", ctrlKey: true })).toBe(true);
    expect(blockIds()).toEqual(["a"]);
    expect(press({ key: "Z", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(blockIds()).toEqual(["a", "b"]);

    // 搭建的修改和它的撤销记录都还在
    expect(objectName(7)).toBe("改过的名字");
    expect(project().canUndo).toBe(true);
  });

  it("does nothing and lets the key through when the editor has nothing to undo", async () => {
    renderConsole();
    await prepare();
    while (builder().canUndoEdit) act(() => void builder().handleUndoEdit());

    expect(press({ ctrlKey: true })).toBe(false);
    expect(objectName(7)).toBe("改过的名字");
  });

  it("leaves Ctrl+Z to a focused text input", async () => {
    renderConsole();
    await prepare();
    const input = screen.getByRole("textbox", { name: "名字输入框" });
    input.focus();

    expect(press({ ctrlKey: true }, input)).toBe(false);
    expect(blockIds()).toEqual(["a", "b"]);
  });

  it("the app menu 撤销 / 重做 follow the editor on this page", async () => {
    renderConsole();
    await prepare();
    fireEvent.click(screen.getByRole("button", { name: "打开应用菜单" }));
    const redoItem = screen.getByRole("button", { name: /^重做/ }) as HTMLButtonElement;
    expect(redoItem.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /^撤销/ }));
    expect(blockIds()).toEqual(["a"]);
    expect(objectName(7)).toBe("改过的名字");
  });

  it("on the 搭建 page Ctrl+Z undoes 搭建 and leaves the editor alone", async () => {
    renderConsole();
    await prepare();
    act(() => handles.current.setNav!("devices"));

    expect(press({ ctrlKey: true })).toBe(true);
    expect(objectName(7)).not.toBe("改过的名字");
    expect(blockIds()).toEqual(["a", "b"]);
    expect(builder().canUndoEdit).toBe(true);

    // 回到动作编辑页，编辑器的撤销照常
    act(() => handles.current.setNav!("sequences"));
    expect(press({ ctrlKey: true })).toBe(true);
    expect(blockIds()).toEqual(["a"]);
  });
});
