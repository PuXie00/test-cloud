// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { ProjectContext } from "@/app/project/project-provider";
import {
  formatProjectHistoryAriaKeyshortcuts,
  formatProjectHistoryShortcutHint,
  resolveProjectHistoryShortcut,
} from "@/app/project/project-history-shortcuts";

const {
  toastError,
  consoleModeState,
} = vi.hoisted(() => ({
  toastError: vi.fn(),
  consoleModeState: {
    current: {
      mode: "rehearsal" as "rehearsal" | "show",
      isLocked: false,
      enterShow: vi.fn(),
      exitShow: vi.fn(),
      lock: vi.fn(),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
    warning: vi.fn(),
  },
}));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/app/auth/use-auth", () => ({
  useAuth: () => ({
    user: { role: "admin" },
    logout: vi.fn(),
  }),
}));

vi.mock("@/app/pages/console/hooks/use-console-mode", () => ({
  useConsoleMode: () => consoleModeState.current,
}));

vi.mock("@/app/pages/console/hooks/use-program", () => ({
  useProgram: () => ({
    program: { id: "p1", name: "节目", chapters: [] },
  }),
}));

vi.mock(
  "@/app/pages/console/components/drive-debug/alignment-checklist/alignment-checklist-provider",
  () => ({
    useAlignmentChecklist: () => ({
      allConfirmed: true,
      openDialog: vi.fn(),
      dialogOpen: false,
    }),
  }),
);

vi.mock("@/app/components/ics/emergency-stop-button", () => ({
  EmergencyStopButton: () => null,
}));

vi.mock("@/app/components/project-center", () => ({
  ProjectCenterDialog: () => null,
}));

vi.mock(
  "@/app/pages/console/components/show-mode-confirm/show-mode-confirm-dialog",
  () => ({
    ShowModeConfirmDialog: () => null,
  }),
);

vi.mock("@/app/pages/console/components/collaboration/collab-dialog", () => ({
  CollabDialog: () => null,
}));

vi.mock(
  "@/app/pages/console/components/collaboration/collab-quick-popover",
  () => ({
    CollabQuickPopover: () => null,
  }),
);

vi.mock("@/app/pages/console/components/permissions/permissions-dialog", () => ({
  PermissionsDialog: () => null,
}));

vi.mock(
  "@/app/pages/console/components/system-settings/system-settings-dialog",
  () => ({
    SystemSettingsDialog: () => null,
  }),
);

vi.mock(
  "@/app/pages/console/components/drive-debug/alignment-checklist/alignment-checklist-dialog",
  () => ({
    AlignmentChecklistDialog: () => null,
  }),
);

vi.mock(
  "@/app/pages/console/components/system-status/system-status-popover",
  () => ({
    SystemStatusPopover: () => null,
  }),
);

vi.mock("@/app/viz3d", () => ({
  getViz3DEngine: () => ({
    getSavedView: () => null,
    captureCoverPngBase64: () => null,
  }),
}));

import { TopBar } from "@/app/pages/console/components/TopBar";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: ResizeObserverStub,
  });
});

afterEach(() => {
  cleanup();
  toastError.mockClear();
  consoleModeState.current.mode = "rehearsal";
});

type ShortcutPartial = Partial<{
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}>;

const makeKeyboardEvent = (partial: ShortcutPartial) => ({
  key: partial.key ?? "z",
  ctrlKey: partial.ctrlKey ?? false,
  metaKey: partial.metaKey ?? false,
  shiftKey: partial.shiftKey ?? false,
  altKey: partial.altKey ?? false,
  target: partial.target ?? document.body,
});

describe("resolveProjectHistoryShortcut", () => {
  it.each([
    [{ key: "z", ctrlKey: true, shiftKey: false }, "undo"],
    [{ key: "Z", ctrlKey: true, shiftKey: true }, "redo"],
    [{ key: "y", ctrlKey: true, shiftKey: false }, "redo"],
    [{ key: "z", metaKey: true, shiftKey: false }, "undo"],
    [{ key: "z", metaKey: true, shiftKey: true }, "redo"],
    [{ key: "y", metaKey: true, shiftKey: false }, "redo"],
  ] as const)("resolves history shortcuts %#", (partial, expected) => {
    expect(resolveProjectHistoryShortcut(makeKeyboardEvent(partial))).toBe(
      expected,
    );
  });

  it("ignores shortcuts with Alt", () => {
    expect(
      resolveProjectHistoryShortcut(
        makeKeyboardEvent({ key: "z", ctrlKey: true, altKey: true }),
      ),
    ).toBeNull();
  });

  it("ignores shortcuts without Ctrl or Meta", () => {
    expect(
      resolveProjectHistoryShortcut(makeKeyboardEvent({ key: "z" })),
    ).toBeNull();
  });

  it.each(["input", "textarea", "select"] as const)(
    "does not intercept editable %s",
    (tagName) => {
      const target = document.createElement(tagName);
      expect(
        resolveProjectHistoryShortcut(
          makeKeyboardEvent({ key: "z", ctrlKey: true, target }),
        ),
      ).toBeNull();
    },
  );

  it("does not intercept contenteditable", () => {
    const target = document.createElement("div");
    target.contentEditable = "true";
    expect(
      resolveProjectHistoryShortcut(
        makeKeyboardEvent({ key: "z", ctrlKey: true, target }),
      ),
    ).toBeNull();
  });

  it("allows global history on readonly and disabled inputs", () => {
    const readonly = document.createElement("input");
    readonly.readOnly = true;
    const disabled = document.createElement("input");
    disabled.disabled = true;
    expect(
      resolveProjectHistoryShortcut(
        makeKeyboardEvent({ key: "z", ctrlKey: true, target: readonly }),
      ),
    ).toBe("undo");
    expect(
      resolveProjectHistoryShortcut(
        makeKeyboardEvent({ key: "z", ctrlKey: true, target: disabled }),
      ),
    ).toBe("undo");
  });

  it("does not treat Ctrl/Meta+Shift+Y as redo", () => {
    expect(
      resolveProjectHistoryShortcut(
        makeKeyboardEvent({ key: "y", ctrlKey: true, shiftKey: true }),
      ),
    ).toBeNull();
    expect(
      resolveProjectHistoryShortcut(
        makeKeyboardEvent({ key: "Y", metaKey: true, shiftKey: true }),
      ),
    ).toBeNull();
  });
});

describe("project history shortcut presentation", () => {
  it("formats Windows/Linux visible hints and ARIA tokens", () => {
    expect(formatProjectHistoryShortcutHint("undo", "Win32")).toBe("Ctrl+Z");
    expect(formatProjectHistoryShortcutHint("redo", "Linux x86_64")).toBe(
      "Ctrl+Shift+Z / Ctrl+Y",
    );
    expect(formatProjectHistoryAriaKeyshortcuts("undo", "Win32")).toBe(
      "Control+Z",
    );
    expect(formatProjectHistoryAriaKeyshortcuts("redo", "Win32")).toBe(
      "Control+Shift+Z Control+Y",
    );
  });

  it("formats macOS visible hints and ARIA tokens without Control+Y", () => {
    expect(formatProjectHistoryShortcutHint("undo", "MacIntel")).toBe("⌘Z");
    expect(formatProjectHistoryShortcutHint("redo", "MacIntel")).toBe("⇧⌘Z");
    expect(formatProjectHistoryShortcutHint("redo", "MacIntel")).not.toMatch(
      /Ctrl|Control|Y/i,
    );
    expect(formatProjectHistoryAriaKeyshortcuts("undo", "MacIntel")).toBe(
      "Meta+Z",
    );
    expect(formatProjectHistoryAriaKeyshortcuts("redo", "MacIntel")).toBe(
      "Meta+Shift+Z",
    );
    expect(formatProjectHistoryAriaKeyshortcuts("redo", "MacIntel")).not.toMatch(
      /Control|Y/,
    );
  });
});

const ok = (changed: boolean) => ({ ok: true as const, changed });

const createTopBarProjectMock = (overrides?: {
  canUndo?: boolean;
  canRedo?: boolean;
  undoLabel?: string | null;
  redoLabel?: string | null;
  isSaving?: boolean;
  undoResult?: { ok: true; changed: boolean } | { ok: false; changed: false; reason: string };
  redoResult?: { ok: true; changed: boolean } | { ok: false; changed: false; reason: string };
}) => {
  const undoProjectConfiguration = vi.fn(
    () => overrides?.undoResult ?? ok(true),
  );
  const redoProjectConfiguration = vi.fn(
    () => overrides?.redoResult ?? ok(true),
  );

  return {
    canUndo: overrides?.canUndo ?? true,
    canRedo: overrides?.canRedo ?? true,
    undoLabel: overrides?.undoLabel ?? "删除物体",
    redoLabel: overrides?.redoLabel ?? "删除物体",
    isSaving: overrides?.isSaving ?? false,
    isDirty: false,
    currentProject: { id: "p1", name: "测试工程", folderName: "p1" },
    saveCurrentProject: vi.fn(),
    saveProjectAs: vi.fn(),
    closeProject: vi.fn(),
    importProject: vi.fn(),
    exportProject: vi.fn(),
    undoProjectConfiguration,
    redoProjectConfiguration,
    asContextValue: () =>
      ({
        canUndo: overrides?.canUndo ?? true,
        canRedo: overrides?.canRedo ?? true,
        undoLabel: overrides?.undoLabel ?? "删除物体",
        redoLabel: overrides?.redoLabel ?? "删除物体",
        isSaving: overrides?.isSaving ?? false,
        isDirty: false,
        currentProject: { id: "p1", name: "测试工程", folderName: "p1" },
        saveCurrentProject: vi.fn(),
        saveProjectAs: vi.fn(),
        closeProject: vi.fn(),
        importProject: vi.fn(),
        exportProject: vi.fn(),
        undoProjectConfiguration,
        redoProjectConfiguration,
      }) as unknown as ComponentProps<typeof ProjectContext.Provider>["value"],
  };
};

const renderTopBar = (
  project: ReturnType<typeof createTopBarProjectMock>,
  ui?: ReactNode,
) =>
  render(
    createElement(
      ProjectContext.Provider,
      { value: project.asContextValue() },
      ui ?? createElement(TopBar, { onStop: vi.fn() }),
    ),
  );

const openAppMenu = () => {
  fireEvent.click(screen.getByRole("button", { name: "打开应用菜单" }));
};

describe("TopBar undo/redo controls", () => {
  beforeEach(() => {
    consoleModeState.current.mode = "rehearsal";
  });

  it("labels menu items with simple undo/redo text and shortcut hints", () => {
    const project = createTopBarProjectMock({
      undoLabel: "删除物体",
      redoLabel: "删除物体",
    });
    renderTopBar(project);
    openAppMenu();

    const undo = screen.getByRole("button", { name: /^撤销/ });
    const redo = screen.getByRole("button", { name: /^重做/ });
    expect(undo).toHaveProperty("disabled", false);
    expect(redo).toHaveProperty("disabled", false);
    const undoHint = formatProjectHistoryShortcutHint("undo");
    const redoHint = formatProjectHistoryShortcutHint("redo");
    const undoAria = formatProjectHistoryAriaKeyshortcuts("undo");
    const redoAria = formatProjectHistoryAriaKeyshortcuts("redo");
    expect(undo.getAttribute("aria-keyshortcuts")).toBe(undoAria);
    expect(redo.getAttribute("aria-keyshortcuts")).toBe(redoAria);
    expect(undo.getAttribute("aria-label")).toBe("撤销");
    expect(undo.getAttribute("title")).toBe("撤销");
    expect(redo.getAttribute("aria-label")).toBe("重做");
    expect(redo.getAttribute("title")).toBe("重做");
    expect(undo.textContent).toContain("撤销");
    expect(undo.textContent).toContain(undoHint);
    expect(redo.textContent).toContain("重做");
    expect(redo.textContent).toContain(redoHint);
  });

  it("keeps macOS redo presentation free of Control/Ctrl+Y", () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "platform",
    );
    Object.defineProperty(Navigator.prototype, "platform", {
      configurable: true,
      get: () => "MacIntel",
    });
    try {
      const project = createTopBarProjectMock();
      renderTopBar(project);
      openAppMenu();
      const redo = screen.getByRole("button", { name: /^重做/ });
      expect(redo.getAttribute("aria-keyshortcuts")).toBe("Meta+Shift+Z");
      expect(redo.getAttribute("aria-label")).toBe("重做");
      expect(redo.textContent).toContain("⇧⌘Z");
      expect(redo.textContent).not.toMatch(/Ctrl|Control|\+Y/i);
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(Navigator.prototype, "platform", platformDescriptor);
      }
    }
  });

  it("disables menu items when history is unavailable", () => {
    const project = createTopBarProjectMock({
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
    });
    renderTopBar(project);
    openAppMenu();

    expect(screen.getByRole("button", { name: /^撤销/ })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: /^重做/ })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("marks unavailable undo/redo with aria/title and keeps menu items readable", () => {
    const project = createTopBarProjectMock({
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
    });
    renderTopBar(project);
    openAppMenu();

    const undo = screen.getByRole("button", { name: /^撤销/ });
    const redo = screen.getByRole("button", { name: /^重做/ });
    expect(undo).toHaveProperty("disabled", true);
    expect(redo).toHaveProperty("disabled", true);
    expect(undo.getAttribute("aria-label")).toMatch(/不可用/);
    expect(undo.getAttribute("title")).toMatch(/不可用/);
    expect(redo.getAttribute("aria-label")).toMatch(/不可用/);
    expect(undo.textContent).toMatch(/不可用/);
  });

  it("disables menu items while saving or when canUndo/canRedo are false for busy transaction", () => {
    const project = createTopBarProjectMock({
      canUndo: false,
      canRedo: false,
      isSaving: true,
      undoLabel: null,
      redoLabel: null,
    });
    renderTopBar(project);
    openAppMenu();

    expect(screen.getByRole("button", { name: /^撤销/ })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: /^重做/ })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("disables history controls in show mode", () => {
    consoleModeState.current.mode = "show";
    const project = createTopBarProjectMock();
    renderTopBar(project);
    openAppMenu();

    expect(screen.getByRole("button", { name: /^撤销/ })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: /^重做/ })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("invokes undo/redo APIs on menu click", () => {
    const project = createTopBarProjectMock();
    renderTopBar(project);
    openAppMenu();

    fireEvent.click(screen.getByRole("button", { name: /^撤销/ }));
    expect(project.undoProjectConfiguration).toHaveBeenCalledTimes(1);

    openAppMenu();
    fireEvent.click(screen.getByRole("button", { name: /^重做/ }));
    expect(project.redoProjectConfiguration).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("toasts short error when undo fails", () => {
    const project = createTopBarProjectMock({
      undoResult: {
        ok: false,
        changed: false,
        reason: "活动事务进行中，请先提交或取消编辑",
      },
    });
    renderTopBar(project);
    openAppMenu();

    fireEvent.click(screen.getByRole("button", { name: /^撤销/ }));
    expect(toastError).toHaveBeenCalledWith(
      "活动事务进行中，请先提交或取消编辑",
    );
  });

  it("handles global shortcuts and only preventDefault when actionable", () => {
    const project = createTopBarProjectMock({
      canUndo: true,
      canRedo: false,
      redoLabel: null,
    });
    renderTopBar(project);

    const undoEvent = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const undoPrevented = !window.dispatchEvent(undoEvent);
    // dispatchEvent returns false when preventDefault was called
    expect(undoPrevented || undoEvent.defaultPrevented).toBe(true);
    expect(project.undoProjectConfiguration).toHaveBeenCalledTimes(1);

    const redoEvent = new KeyboardEvent("keydown", {
      key: "y",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(redoEvent);
    expect(redoEvent.defaultPrevented).toBe(false);
    expect(project.redoProjectConfiguration).not.toHaveBeenCalled();
  });

  it("does not intercept Ctrl+Z inside editable inputs", () => {
    const project = createTopBarProjectMock();
    renderTopBar(project);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: input });
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(project.undoProjectConfiguration).not.toHaveBeenCalled();
    input.remove();
  });

  it("removes the keydown listener on unmount", () => {
    const project = createTopBarProjectMock();
    const view = renderTopBar(project);
    view.unmount();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(project.undoProjectConfiguration).not.toHaveBeenCalled();
  });
});
