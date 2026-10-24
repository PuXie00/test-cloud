// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { createEmptyDocument } from "@/app/project/project-document-empty";
import { ContentLibraryPanel } from "./content-library-panel";

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "共享斜面",
  trajectoryMode: false,
  blocks: [
    {
      id: "pose-1",
      kind: "pose",
      objectId: 7,
      atMs: 1000,
      pose: { v1: 10, v2: 0, v3: 0 },
    },
    {
      id: "slope-1",
      kind: "static-preset",
      presetId: "static-slope",
      atMs: 2000,
      orderedObjectIds: [7, 8],
      params: { baseV1: 0, stepV1: 100, v2: 0, v3: 0 },
    },
  ],
  segments: [],
};

const { builderState, projectState } = vi.hoisted(() => ({
  builderState: {
    current: {} as Record<string, unknown>,
  },
  projectState: {
    current: null as { document: ReturnType<typeof createEmptyDocument> } | null,
  },
}));

vi.mock("../use-action-builder", () => ({
  useActionBuilder: () => builderState.current,
}));

vi.mock("@/app/project/use-project", () => ({
  useProject: () => ({
    currentProject: projectState.current,
  }),
}));

const noop = () => {};

const mockBuilder = (overrides: Record<string, unknown> = {}) => {
  builderState.current = {
    sequences: [sequence],
    draftSequenceIds: new Set<number>(),
    dockMode: "sequence",
    selectedSequenceId: 1,
    programs: [],
    selectedObjectIds: [7],
    handleSequenceSelect: vi.fn(),
    handleCreateSequence: noop,
    handleProgramItemInsert: noop,
    ...overrides,
  };
};

afterEach(() => {
  cleanup();
  projectState.current = null;
});

describe("content library panel", () => {
  beforeEach(() => {
    mockBuilder();
  });

  it("counts authored sequence blocks once and does not read tracks", () => {
    render(<ContentLibraryPanel />);
    expect(screen.getByText("动作序列库")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "搜索动作序列库" })).toBeTruthy();
    expect(screen.getByRole("listbox", { name: "动作序列库列表" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "共享斜面" }).textContent).toMatch(/2 块/);
    expect(screen.getByRole("button", { name: "共享斜面" }).textContent).not.toMatch(/tracks/i);
  });

  it("marks a sequence with an unsaved draft", () => {
    mockBuilder({ draftSequenceIds: new Set([1]) });
    render(<ContentLibraryPanel />);
    const row = screen.getByRole("button", { name: "共享斜面，未保存" });
    expect(row.textContent).toMatch(/未保存/);
  });

  it("marks a sequence with no participants as needing repair", () => {
    mockBuilder({
      sequences: [
        {
          id: 1,
          name: "空序列",
          trajectoryMode: false,
          blocks: [],
          segments: [],
        },
      ],
      selectedSequenceId: null,
    });
    render(<ContentLibraryPanel />);
    expect(screen.getByRole("button", { name: "空序列，待修复" })).not.toBeNull();
  });

  it("marks a sequence with blocking validation issues as needing repair", () => {
    const invalid: ActionSequenceConfig = {
      id: 98,
      name: "坏序列",
      trajectoryMode: false,
      blocks: [
        {
          id: "bad-preset",
          kind: "static-preset",
          presetId: "not-a-preset",
          atMs: 1000,
          orderedObjectIds: [7, 8],
          params: { v1: 0, v2: 0, v3: 0 },
        },
      ],
      segments: [],
    };
    const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
    document.motion.actionSequences = [invalid];
    projectState.current = { document };
    mockBuilder({
      sequences: [invalid],
      selectedSequenceId: 98,
    });
    render(<ContentLibraryPanel />);
    expect(screen.getByRole("button", { name: "坏序列，待修复" })).not.toBeNull();
  });

  it("deselects the current sequence when its library row is clicked again", () => {
    render(<ContentLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "共享斜面" }));
    expect(builderState.current.handleSequenceSelect).toHaveBeenCalledWith(null);
  });

  it("selects a different sequence from the library", () => {
    mockBuilder({
      sequences: [
        sequence,
        {
          id: 2,
          name: "第二序列",
          trajectoryMode: false,
          blocks: [],
          segments: [],
        },
      ],
    });
    render(<ContentLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "第二序列，待修复" }));
    expect(builderState.current.handleSequenceSelect).toHaveBeenCalledWith(2);
  });
});

describe("content library copy / paste", () => {
  const handleSequenceCopy = vi.fn();
  const handleSequencePaste = vi.fn();

  beforeEach(() => {
    handleSequenceCopy.mockClear();
    handleSequencePaste.mockClear();
  });

  const openMenuOn = (element: Element) => {
    fireEvent.contextMenu(element);
    return screen.findByRole("menu");
  };

  it("copies the right-clicked sequence from the context menu", async () => {
    mockBuilder({ handleSequenceCopy, handleSequencePaste, canPasteSequence: false });
    render(<ContentLibraryPanel />);
    await openMenuOn(screen.getByRole("button", { name: "共享斜面" }));
    const paste = screen.getByRole("menuitem", { name: /粘贴为新序列/ });
    expect(paste.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: /复制「共享斜面」/ }));
    expect(handleSequenceCopy).toHaveBeenCalledWith(1);
  });

  it("pastes from the context menu on empty space, where copy is unavailable", async () => {
    mockBuilder({ handleSequenceCopy, handleSequencePaste, canPasteSequence: true });
    render(<ContentLibraryPanel />);
    await openMenuOn(screen.getByRole("listbox", { name: "动作序列库列表" }));
    expect(screen.getByRole("menuitem", { name: /^复制/ }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: /粘贴为新序列/ }));
    expect(handleSequencePaste).toHaveBeenCalledTimes(1);
  });

  it("leaves Ctrl+C / V to the timeline even when a row has focus", () => {
    mockBuilder({ handleSequenceCopy, handleSequencePaste, canPasteSequence: true });
    render(<ContentLibraryPanel />);
    const row = screen.getByRole("button", { name: "共享斜面" });
    expect(fireEvent.keyDown(row, { key: "c", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(row, { key: "v", metaKey: true })).toBe(true);
    expect(handleSequenceCopy).not.toHaveBeenCalled();
    expect(handleSequencePaste).not.toHaveBeenCalled();
  });

  it("shows no shortcut hints in the sequence menu", async () => {
    mockBuilder({ handleSequenceCopy, handleSequencePaste, canPasteSequence: true });
    render(<ContentLibraryPanel />);
    await openMenuOn(screen.getByRole("button", { name: "共享斜面" }));
    expect(screen.getByRole("menuitem", { name: /^复制/ }).textContent).not.toMatch(/C$/);
    expect(screen.getByRole("menuitem", { name: /粘贴为新序列/ }).textContent).toBe("粘贴为新序列");
  });
});

describe("content library rename", () => {
  const second: ActionSequenceConfig = {
    id: 2,
    name: "第二序列",
    trajectoryMode: false,
    blocks: [],
    segments: [],
  };
  const handleRenameSequence = vi.fn(() => null);

  beforeEach(() => {
    handleRenameSequence.mockClear();
    mockBuilder({ sequences: [sequence, second], handleRenameSequence });
  });

  it("renames the selected sequence when its name is clicked, without deselecting it", () => {
    render(<ContentLibraryPanel />);
    fireEvent.click(screen.getByText("共享斜面"));
    expect(builderState.current.handleSequenceSelect).not.toHaveBeenCalled();
    const input = screen.getByRole("textbox", { name: "序列名" });
    expect((input as HTMLInputElement).value).toBe("共享斜面");

    fireEvent.change(input, { target: { value: "第二序列" } });
    expect(screen.getByText("序列名已存在")).toBeTruthy();
    expect((screen.getByRole("button", { name: "确定" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "一二三四五六七八九" } });
    expect((input as HTMLInputElement).value).toBe("一二三四五六七八");
    fireEvent.change(input, { target: { value: "新名字" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(handleRenameSequence).toHaveBeenCalledWith("新名字", 1);
  });

  it("selects an unselected sequence when its name is clicked instead of renaming", () => {
    render(<ContentLibraryPanel />);
    fireEvent.click(screen.getByText("第二序列"));
    expect(builderState.current.handleSequenceSelect).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("textbox", { name: "序列名" })).toBeNull();
  });

  it("renames the right-clicked sequence from the menu, even if it is not selected", async () => {
    render(<ContentLibraryPanel />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "第二序列，待修复" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "重命名「第二序列」" }));
    const input = await screen.findByRole("textbox", { name: "序列名" });
    expect((input as HTMLInputElement).value).toBe("第二序列");
    fireEvent.change(input, { target: { value: "改过的" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(handleRenameSequence).toHaveBeenCalledWith("改过的", 2);
    expect(builderState.current.handleSequenceSelect).not.toHaveBeenCalled();
  });

  it("has no rename on empty space", async () => {
    render(<ContentLibraryPanel />);
    fireEvent.contextMenu(screen.getByRole("listbox", { name: "动作序列库列表" }));
    const rename = await screen.findByRole("menuitem", { name: "重命名" });
    expect(rename.getAttribute("aria-disabled")).toBe("true");
  });
});
