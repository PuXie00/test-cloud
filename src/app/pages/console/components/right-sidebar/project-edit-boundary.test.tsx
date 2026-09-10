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
import {
  useState,
  type ChangeEvent,
  type ComponentProps,
  type ReactNode,
} from "react";
import { NumericInput } from "@/app/components/ics/numeric-input";
import { ProjectContext } from "@/app/project/project-provider";
import { isEditableHistoryTarget } from "@/app/project/project-history-shortcuts";
import { ProjectEditBoundary } from "./project-edit-boundary";

const wizardPreview = vi.fn((next: number) => {
  wizardPreviewValue = next;
});
let wizardPreviewValue = 0;

vi.mock(
  "@/app/pages/console/components/right-sidebar/property-forms/controlled-object-form",
  () => ({
    ControlledObjectForm: () => (
      <NumericInput
        aria-label="位置 X"
        value={wizardPreviewValue}
        onChange={wizardPreview}
      />
    ),
  }),
);

vi.mock(
  "@/app/pages/console/components/right-sidebar/property-forms/plc-form",
  () => ({
    PlcForm: () => (
      <input
        aria-label="IP 地址"
        name="ip"
        defaultValue="0"
        onChange={(event) => wizardPreview(Number(event.target.value) || 0)}
      />
    ),
  }),
);

vi.mock("@/app/pages/console/hooks/use-project-store", () => ({
  useProjectStore: () => ({
    objects: [
      {
        id: "obj-wizard",
        name: "物体-01",
        shapePreset: "cube",
      },
    ],
    plcs: [
      {
        id: "plc-wizard",
        ip: "192.168.1.1",
        masterTypeId: "AC810_1",
        status: "offline",
      },
    ],
    addObjectFromShape: vi.fn(),
    removePlc: vi.fn(),
  }),
}));

vi.mock("@/app/pages/console/hooks/use-object-deletion", () => ({
  useObjectDeletion: () => ({
    impact: null,
    open: false,
    lastError: null,
    requestDelete: vi.fn(),
    cancelDelete: vi.fn(),
    confirmDelete: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/pages/console/components/right-sidebar/delete-impact-dialog", () => ({
  DeleteImpactDialog: () => null,
}));

vi.mock(
  "@/app/pages/console/components/right-sidebar/config-wizard/dialogs/plc-add-dialog",
  () => ({
    PlcAddDialog: () => null,
  }),
);

vi.mock(
  "@/app/pages/console/components/right-sidebar/config-wizard/dialogs/plc-scan-dialog",
  () => ({
    PlcScanDialog: () => null,
  }),
);

afterEach(() => {
  cleanup();
});

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
});

const ok = (changed: boolean) => ({ ok: true as const, changed });

const createProjectHistoryMock = () => {
  let activeOwner: string | null = null;
  let pastCount = 0;
  let value = 0;
  let baseline = 0;
  const previewOwners: Array<string | null> = [];
  const previewEntries: Array<{ owner: string | null; value: number }> = [];
  const pastOwners: string[] = [];

  const beginTrackedEdit = vi.fn((owner: string, _label: string) => {
    if (activeOwner != null) return false;
    activeOwner = owner;
    baseline = value;
    return true;
  });

  const commitTrackedEdit = vi.fn((owner: string) => {
    if (activeOwner !== owner) {
      return { ok: false as const, changed: false as const, reason: "owner mismatch" };
    }
    activeOwner = null;
    if (value === baseline) {
      return ok(false);
    }
    pastCount += 1;
    pastOwners.push(owner);
    baseline = value;
    return ok(true);
  });

  const cancelTrackedEdit = vi.fn((owner: string) => {
    if (activeOwner !== owner) {
      return { ok: false as const, changed: false as const, reason: "owner mismatch" };
    }
    activeOwner = null;
    value = baseline;
    return ok(true);
  });

  const undoProjectConfiguration = vi.fn(() => {
    if (pastOwners.length === 0) {
      return ok(false);
    }
    pastOwners.pop();
    pastCount = pastOwners.length;
    return ok(true);
  });

  return {
    beginTrackedEdit,
    commitTrackedEdit,
    cancelTrackedEdit,
    undoProjectConfiguration,
    previewPosition: vi.fn((next: number) => {
      previewOwners.push(activeOwner);
      previewEntries.push({ owner: activeOwner, value: next });
      value = next;
    }),
    previewOwners,
    previewEntries,
    pastOwners,
    get pastCount() {
      return pastCount;
    },
    get activeOwner() {
      return activeOwner;
    },
    asContextValue: () =>
      ({
        beginTrackedEdit,
        commitTrackedEdit,
        cancelTrackedEdit,
        undoProjectConfiguration,
      }) as unknown as ComponentProps<typeof ProjectContext.Provider>["value"],
  };
};

const renderWithBoundary = (
  project: ReturnType<typeof createProjectHistoryMock>,
  ui: ReactNode,
  ownerPrefix = "property:object-a",
) =>
  render(
    <ProjectContext.Provider value={project.asContextValue()}>
      <ProjectEditBoundary ownerPrefix={ownerPrefix} label="修改受控物体">
        {ui}
      </ProjectEditBoundary>
    </ProjectContext.Provider>,
  );

describe("isEditableHistoryTarget", () => {
  it("recognizes input, textarea, select, and contenteditable", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    const plain = document.createElement("div");

    expect(isEditableHistoryTarget(input)).toBe(true);
    expect(isEditableHistoryTarget(textarea)).toBe(true);
    expect(isEditableHistoryTarget(select)).toBe(true);
    expect(isEditableHistoryTarget(editable)).toBe(true);
    expect(isEditableHistoryTarget(plain)).toBe(false);
    expect(isEditableHistoryTarget(null)).toBe(false);
  });

  it("treats readonly and disabled controls as non-editable for shortcut gating", () => {
    const readonlyInput = document.createElement("input");
    readonlyInput.readOnly = true;
    const disabledInput = document.createElement("input");
    disabledInput.disabled = true;
    const disabledSelect = document.createElement("select");
    disabledSelect.disabled = true;

    expect(isEditableHistoryTarget(readonlyInput)).toBe(false);
    expect(isEditableHistoryTarget(disabledInput)).toBe(false);
    expect(isEditableHistoryTarget(disabledSelect)).toBe(false);
  });
});

describe("ProjectEditBoundary native input", () => {
  it("groups focus/change/blur into one commit", () => {
    const project = createProjectHistoryMock();
    const onChange = vi.fn((event: ChangeEvent<HTMLInputElement>) => {
      project.previewPosition(Number(event.target.value) || 0);
    });

    renderWithBoundary(
      project,
      <input aria-label="名称" name="name" defaultValue="0" onChange={onChange} />,
    );

    const input = screen.getByLabelText("名称");
    fireEvent.focusIn(input);
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.focusOut(input);

    expect(project.beginTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.beginTrackedEdit).toHaveBeenCalledWith(
      "property:object-a:name",
      "修改受控物体",
    );
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.pastCount).toBe(1);
  });

  it("commits on Enter after the input handler", () => {
    const project = createProjectHistoryMock();
    const onChange = vi.fn((event: ChangeEvent<HTMLInputElement>) => {
      project.previewPosition(Number(event.target.value) || 0);
    });
    const onKeyDown = vi.fn();

    renderWithBoundary(
      project,
      <input
        aria-label="名称"
        name="name"
        defaultValue="0"
        onChange={onChange}
        onKeyDown={onKeyDown}
      />,
    );

    const input = screen.getByLabelText("名称");
    fireEvent.focusIn(input);
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onKeyDown).toHaveBeenCalled();
    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.pastCount).toBe(1);
  });

  it("cancels on Escape after the input handler", () => {
    const project = createProjectHistoryMock();
    const onChange = vi.fn((event: ChangeEvent<HTMLInputElement>) => {
      project.previewPosition(Number(event.target.value) || 0);
    });
    const onKeyDown = vi.fn();

    renderWithBoundary(
      project,
      <input
        aria-label="名称"
        name="name"
        defaultValue="0"
        onChange={onChange}
        onKeyDown={onKeyDown}
      />,
    );

    const input = screen.getByLabelText("名称");
    fireEvent.focusIn(input);
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onKeyDown).toHaveBeenCalled();
    expect(project.cancelTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.commitTrackedEdit).not.toHaveBeenCalled();
    expect(project.pastCount).toBe(0);
  });

  it("does not create history when the final value matches the start", () => {
    const project = createProjectHistoryMock();
    const onChange = vi.fn((event: ChangeEvent<HTMLInputElement>) => {
      project.previewPosition(Number(event.target.value) || 0);
    });

    renderWithBoundary(
      project,
      <input aria-label="名称" name="name" defaultValue="0" onChange={onChange} />,
    );

    const input = screen.getByLabelText("名称");
    fireEvent.focusIn(input);
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.focusOut(input);

    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.pastCount).toBe(0);
  });

  it("reopens a focus transaction after Enter while still focused", () => {
    const project = createProjectHistoryMock();
    const onChange = vi.fn((event: ChangeEvent<HTMLInputElement>) => {
      project.previewPosition(Number(event.target.value) || 0);
    });

    renderWithBoundary(
      project,
      <input aria-label="名称" name="name" defaultValue="0" onChange={onChange} />,
    );

    const input = screen.getByLabelText("名称");
    fireEvent.focusIn(input);
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(project.pastCount).toBe(1);
    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.activeOwner).toBeNull();

    fireEvent.change(input, { target: { value: "6" } });
    expect(project.beginTrackedEdit).toHaveBeenCalledTimes(2);
    expect(project.activeOwner).toBe("property:object-a:name");
    expect(onChange.mock.invocationCallOrder[1]!).toBeGreaterThan(
      project.beginTrackedEdit.mock.invocationCallOrder[1]!,
    );

    fireEvent.focusOut(input);
    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(2);
    expect(project.pastCount).toBe(2);
  });
});

describe("ProjectEditBoundary NumericInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts once, previews repeatedly, and commits once for a scrub", () => {
    const project = createProjectHistoryMock();
    renderWithBoundary(
      project,
      <NumericInput
        aria-label="位置 X"
        value={0}
        onChange={project.previewPosition}
      />,
    );

    const value = screen.getByText("0").parentElement!;
    fireEvent.pointerDown(value, { pointerId: 1, button: 0, clientX: 10 });
    fireEvent.pointerMove(value, { pointerId: 1, clientX: 20 });
    fireEvent.pointerMove(value, { pointerId: 1, clientX: 30 });
    fireEvent.pointerUp(value, { pointerId: 1, clientX: 30 });

    expect(project.beginTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.beginTrackedEdit).toHaveBeenCalledWith(
      "property:object-a:位置 X",
      "修改受控物体",
    );
    expect(project.previewPosition.mock.calls.length).toBeGreaterThan(1);
    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.pastCount).toBe(1);
  });

  it("cancels an active scrub on pointer cancel", () => {
    const project = createProjectHistoryMock();
    renderWithBoundary(
      project,
      <NumericInput
        aria-label="位置 X"
        value={0}
        onChange={project.previewPosition}
      />,
    );

    const value = screen.getByText("0").parentElement!;
    fireEvent.pointerDown(value, { pointerId: 1, button: 0, clientX: 10 });
    fireEvent.pointerMove(value, { pointerId: 1, clientX: 30 });
    fireEvent.pointerCancel(value, { pointerId: 1 });

    expect(project.cancelTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.commitTrackedEdit).not.toHaveBeenCalled();
  });

  it("does not double-begin or double-commit for a step click", () => {
    const project = createProjectHistoryMock();
    const Harness = () => {
      const [value, setValue] = useState(0);
      return (
        <NumericInput
          aria-label="位置 X"
          value={value}
          onChange={(next) => {
            project.previewPosition(next);
            setValue(next);
          }}
        />
      );
    };

    renderWithBoundary(project, <Harness />);

    const increase = screen.getByRole("button", { name: "增加" });
    fireEvent.pointerDown(increase, { pointerId: 1, button: 0 });
    fireEvent.mouseDown(increase, { button: 0 });
    fireEvent.pointerUp(increase, { pointerId: 1, button: 0 });
    fireEvent.mouseUp(increase, { button: 0 });

    expect(project.beginTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.pastCount).toBe(1);
  });

  it("no-op commits pointer transaction then opens a text transaction on click-to-edit", () => {
    const project = createProjectHistoryMock();
    renderWithBoundary(
      project,
      <NumericInput
        aria-label="位置 X"
        value={0}
        onChange={project.previewPosition}
      />,
    );

    const display = screen.getByLabelText("位置 X");
    fireEvent.pointerDown(display, { pointerId: 1, button: 0, clientX: 0 });
    fireEvent.pointerUp(display, { pointerId: 1, button: 0, clientX: 0 });

    // pointer gesture commits with no semantic change; auto-focus starts a text session.
    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.pastCount).toBe(0);
    expect(project.beginTrackedEdit).toHaveBeenCalledTimes(2);

    const input = screen.getByRole("textbox", { name: "位置 X" });
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(2);
    expect(project.pastCount).toBe(1);
  });

  it("cancels on Escape after NumericInput discards its draft", () => {
    const project = createProjectHistoryMock();
    const Harness = () => {
      const [value, setValue] = useState(0);
      return (
        <NumericInput
          aria-label="位置 X"
          value={value}
          onChange={(next) => {
            project.previewPosition(next);
            setValue(next);
          }}
        />
      );
    };

    renderWithBoundary(project, <Harness />);

    const display = screen.getByLabelText("位置 X");
    fireEvent.pointerDown(display, { pointerId: 1, button: 0, clientX: 0 });
    fireEvent.pointerUp(display, { pointerId: 1, button: 0, clientX: 0 });

    const input = screen.getByRole("textbox", { name: "位置 X" });
    fireEvent.focusIn(input);
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(project.cancelTrackedEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox", { name: "位置 X" })).toBeNull();
    expect(screen.getByLabelText("位置 X").textContent).toContain("0");
  });

  it("commits focus field A before scrubbing NumericInput B without owner bleed", () => {
    const project = createProjectHistoryMock();
    const onNameChange = vi.fn((event: ChangeEvent<HTMLInputElement>) => {
      project.previewPosition(Number(event.target.value) || 0);
    });

    renderWithBoundary(
      project,
      <>
        <input
          aria-label="名称"
          name="name"
          defaultValue="0"
          onChange={onNameChange}
        />
        <NumericInput
          aria-label="位置 X"
          value={0}
          onChange={project.previewPosition}
        />
      </>,
    );

    const nameInput = screen.getByLabelText("名称");
    fireEvent.focusIn(nameInput);
    fireEvent.change(nameInput, { target: { value: "5" } });
    expect(project.activeOwner).toBe("property:object-a:name");

    const scrub = screen.getByText("0").parentElement!;
    fireEvent.pointerDown(scrub, { pointerId: 1, button: 0, clientX: 10 });
    expect(project.commitTrackedEdit.mock.calls[0]?.[0]).toBe(
      "property:object-a:name",
    );
    expect(project.activeOwner).toBe("property:object-a:位置 X");

    fireEvent.pointerMove(scrub, { pointerId: 1, clientX: 20 });
    fireEvent.pointerMove(scrub, { pointerId: 1, clientX: 30 });
    fireEvent.pointerUp(scrub, { pointerId: 1, clientX: 30 });

    const scrubOwners = project.previewOwners.slice(1);
    expect(scrubOwners.length).toBeGreaterThan(1);
    expect(scrubOwners.every((owner) => owner === "property:object-a:位置 X")).toBe(
      true,
    );
    expect(project.commitTrackedEdit.mock.calls.map((call) => call[0])).toEqual([
      "property:object-a:name",
      "property:object-a:位置 X",
    ]);

    fireEvent.focusOut(nameInput);
    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(2);
  });

  it("commits step when mouse is released outside the boundary", () => {
    const project = createProjectHistoryMock();
    const Harness = () => {
      const [value, setValue] = useState(0);
      return (
        <NumericInput
          aria-label="位置 X"
          value={value}
          onChange={(next) => {
            project.previewPosition(next);
            setValue(next);
          }}
        />
      );
    };

    const view = renderWithBoundary(project, <Harness />);
    const increase = screen.getByRole("button", { name: "增加" });

    fireEvent.pointerDown(increase, { pointerId: 1, button: 0 });
    fireEvent.mouseDown(increase, { button: 0 });
    expect(project.beginTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.activeOwner).toBe("property:object-a:位置 X");

    fireEvent.mouseUp(window);
    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.cancelTrackedEdit).not.toHaveBeenCalled();
    expect(project.activeOwner).toBeNull();
    expect(project.pastCount).toBe(1);

    view.unmount();
    expect(project.cancelTrackedEdit).not.toHaveBeenCalled();
  });

  it("flushes NumericInput A draft into A before scrubbing B", () => {
    const project = createProjectHistoryMock();
    const Harness = () => {
      const [x, setX] = useState(0);
      const [y, setY] = useState(0);
      return (
        <>
          <NumericInput
            aria-label="位置 X"
            value={x}
            onChange={(next) => {
              project.previewPosition(next);
              setX(next);
            }}
          />
          <NumericInput
            aria-label="位置 Y"
            value={y}
            onChange={(next) => {
              project.previewPosition(next);
              setY(next);
            }}
          />
        </>
      );
    };

    renderWithBoundary(project, <Harness />);

    const displayX = screen.getByLabelText("位置 X");
    fireEvent.pointerDown(displayX, { pointerId: 1, button: 0, clientX: 0 });
    fireEvent.pointerUp(displayX, { pointerId: 1, button: 0, clientX: 0 });

    const inputX = screen.getByRole("textbox", { name: "位置 X" });
    inputX.focus();
    fireEvent.focusIn(inputX);
    fireEvent.change(inputX, { target: { value: "12" } });
    expect(project.previewEntries.some((entry) => entry.value === 12)).toBe(
      false,
    );
    expect(document.activeElement).toBe(inputX);

    const displayY = screen.getByLabelText("位置 Y");
    fireEvent.pointerDown(displayY, { pointerId: 2, button: 0, clientX: 10 });

    expect(
      project.previewEntries.some(
        (entry) =>
          entry.value === 12 && entry.owner === "property:object-a:位置 X",
      ),
    ).toBe(true);
    expect(project.commitTrackedEdit.mock.calls[0]?.[0]).toBe(
      "property:object-a:位置 X",
    );
    expect(project.activeOwner).toBe("property:object-a:位置 Y");

    fireEvent.pointerMove(displayY, { pointerId: 2, clientX: 20 });
    fireEvent.pointerMove(displayY, { pointerId: 2, clientX: 40 });
    fireEvent.pointerUp(displayY, { pointerId: 2, clientX: 40 });

    const yPreviews = project.previewEntries.filter(
      (entry) => entry.owner === "property:object-a:位置 Y",
    );
    expect(yPreviews.length).toBeGreaterThan(0);
    expect(
      project.previewEntries.some(
        (entry) =>
          entry.value === 12 && entry.owner === "property:object-a:位置 Y",
      ),
    ).toBe(false);
    expect(project.pastOwners).toEqual([
      "property:object-a:位置 X",
      "property:object-a:位置 Y",
    ]);
    expect(project.activeOwner).toBeNull();

    project.undoProjectConfiguration();
    expect(project.pastOwners).toEqual(["property:object-a:位置 X"]);
    project.undoProjectConfiguration();
    expect(project.pastOwners).toEqual([]);
    expect(project.activeOwner).toBeNull();
  });

  it("commits NumericInput draft on natural blur without hanging", () => {
    const project = createProjectHistoryMock();
    const Harness = () => {
      const [value, setValue] = useState(0);
      return (
        <NumericInput
          aria-label="位置 X"
          value={value}
          onChange={(next) => {
            project.previewPosition(next);
            setValue(next);
          }}
        />
      );
    };

    renderWithBoundary(project, <Harness />);

    const display = screen.getByLabelText("位置 X");
    fireEvent.pointerDown(display, { pointerId: 1, button: 0, clientX: 0 });
    fireEvent.pointerUp(display, { pointerId: 1, button: 0, clientX: 0 });

    const input = screen.getByRole("textbox", { name: "位置 X" });
    input.focus();
    fireEvent.focusIn(input);
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.focusOut(input);

    expect(
      project.previewEntries.some(
        (entry) =>
          entry.value === 8 && entry.owner === "property:object-a:位置 X",
      ),
    ).toBe(true);
    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(2); // pointer no-op + focus
    expect(project.pastOwners).toEqual(["property:object-a:位置 X"]);
    expect(project.activeOwner).toBeNull();
  });
});

describe("ProjectEditBoundary cleanup", () => {
  it("cancels the active owner on unmount", () => {
    const project = createProjectHistoryMock();
    const view = renderWithBoundary(
      project,
      <input aria-label="名称" name="name" defaultValue="0" />,
    );

    fireEvent.focusIn(screen.getByLabelText("名称"));
    expect(project.activeOwner).toBe("property:object-a:name");

    view.unmount();
    expect(project.cancelTrackedEdit).toHaveBeenCalledWith("property:object-a:name");
  });
});

describe("config wizard ProjectEditBoundary wiring", () => {
  beforeEach(() => {
    wizardPreviewValue = 0;
    wizardPreview.mockReset();
    wizardPreview.mockImplementation((next: number) => {
      wizardPreviewValue = next;
    });
  });

  it("StepAddObjects wraps ControlledObjectForm so NumericInput scrub is one history step", async () => {
    const { StepAddObjects } = await import(
      "./config-wizard/steps/step-add-objects"
    );
    const project = createProjectHistoryMock();
    wizardPreview.mockImplementation((next: number) => {
      project.previewPosition(next);
      wizardPreviewValue = next;
    });

    render(
      <ProjectContext.Provider value={project.asContextValue()}>
        <StepAddObjects />
      </ProjectContext.Provider>,
    );

    expect(
      document.querySelector('[data-project-edit-boundary="wizard:object:obj-wizard"]'),
    ).toBeTruthy();

    const value = screen.getByText("0").parentElement!;
    fireEvent.pointerDown(value, { pointerId: 1, button: 0, clientX: 10 });
    fireEvent.pointerMove(value, { pointerId: 1, clientX: 20 });
    fireEvent.pointerMove(value, { pointerId: 1, clientX: 30 });
    fireEvent.pointerUp(value, { pointerId: 1, clientX: 30 });

    expect(project.beginTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.beginTrackedEdit).toHaveBeenCalledWith(
      "wizard:object:obj-wizard:位置 X",
      "修改受控物体",
    );
    expect(project.previewPosition.mock.calls.length).toBeGreaterThan(1);
    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.pastCount).toBe(1);
  });

  it("StepAddPlc wraps PlcForm so continuous edits commit once", async () => {
    const { StepAddPlc } = await import("./config-wizard/steps/step-add-plc");
    const project = createProjectHistoryMock();
    wizardPreview.mockImplementation((next: number) => {
      project.previewPosition(next);
      wizardPreviewValue = next;
    });

    render(
      <ProjectContext.Provider value={project.asContextValue()}>
        <StepAddPlc />
      </ProjectContext.Provider>,
    );

    expect(
      document.querySelector('[data-project-edit-boundary="wizard:plc:plc-wizard"]'),
    ).toBeTruthy();

    const input = screen.getByLabelText("IP 地址");
    fireEvent.focusIn(input);
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.focusOut(input);

    expect(project.beginTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.beginTrackedEdit).toHaveBeenCalledWith(
      "wizard:plc:plc-wizard:ip",
      "修改 PLC",
    );
    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.pastCount).toBe(1);
  });
});
