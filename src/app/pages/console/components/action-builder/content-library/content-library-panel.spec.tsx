// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { createEmptyDocument } from "@/app/project/project-document-empty";
import { ContentLibraryPanel } from "./content-library-panel";

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "共享斜面",
  trajectoryMode: "non-forced",
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

  it("marks a sequence with no participants as needing repair", () => {
    mockBuilder({
      sequences: [
        {
          id: 1,
          name: "空序列",
          trajectoryMode: "non-forced",
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
      trajectoryMode: "non-forced",
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
          trajectoryMode: "non-forced",
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
