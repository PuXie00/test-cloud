// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionBuilderSelectionSync } from "./action-builder-selection-sync";

const { navState, selectionState, builderState, storeState } = vi.hoisted(() => ({
  navState: { current: { activeNav: "sequences" as string } },
  selectionState: {
    current: {
      selectedId: 7 as number | null,
      multiSelectedIds: [7] as number[],
      objectSelectGeneration: 0,
    },
  },
  builderState: {
    current: {
      selection: { kind: "block", blockId: "pose" } as
        | { kind: "block"; blockId: string }
        | { kind: "multi-block"; blockIds: string[] }
        | null,
      selectedObjectIds: [7] as number[],
      handleObjectsSelect: vi.fn(),
    },
  },
  storeState: {
    current: {
      objects: [{ id: 7 }, { id: 8 }],
    },
  },
}));

vi.mock("../../hooks/use-console-nav", () => ({
  useConsoleNav: () => navState.current,
}));

vi.mock("../../hooks/use-selection", () => ({
  useSelection: () => selectionState.current,
}));

vi.mock("./use-action-builder", () => ({
  useActionBuilder: () => builderState.current,
}));

vi.mock("../../hooks/use-project-store", () => ({
  useProjectStore: () => storeState.current,
}));

afterEach(() => {
  cleanup();
  navState.current.activeNav = "sequences";
  selectionState.current = {
    selectedId: 7,
    multiSelectedIds: [7],
    objectSelectGeneration: 0,
  };
  builderState.current = {
    selection: { kind: "block", blockId: "pose" },
    selectedObjectIds: [7],
    handleObjectsSelect: vi.fn(),
  };
  storeState.current.objects = [{ id: 7 }, { id: 8 }];
});

describe("ActionBuilderSelectionSync", () => {
  it("does not clear a timeline block until 3D object selection changes", () => {
    const { rerender } = render(<ActionBuilderSelectionSync />);
    expect(builderState.current.handleObjectsSelect).not.toHaveBeenCalled();

    builderState.current = {
      ...builderState.current,
      selection: { kind: "block", blockId: "later" },
    };
    rerender(<ActionBuilderSelectionSync />);
    expect(builderState.current.handleObjectsSelect).not.toHaveBeenCalled();
  });

  it("clears the timeline block when 3D selection changes to another object", () => {
    const { rerender } = render(<ActionBuilderSelectionSync />);
    selectionState.current = {
      selectedId: 8,
      multiSelectedIds: [8],
      objectSelectGeneration: 1,
    };
    rerender(<ActionBuilderSelectionSync />);
    expect(builderState.current.handleObjectsSelect).toHaveBeenCalledWith([8]);
  });

  it("clears the timeline block when 3D reselects the same object", () => {
    const { rerender } = render(<ActionBuilderSelectionSync />);
    selectionState.current = {
      ...selectionState.current,
      objectSelectGeneration: 1,
    };
    rerender(<ActionBuilderSelectionSync />);
    expect(builderState.current.handleObjectsSelect).toHaveBeenCalledWith([7]);
  });
});
