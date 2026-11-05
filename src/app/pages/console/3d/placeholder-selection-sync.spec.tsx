// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { state, setUnselectableObjectIds, setUnpickableObjects } = vi.hoisted(() => ({
  state: {
    activeNav: "control",
    objects: [
      { id: 1, controlType: "singlePointMove" },
      { id: 2, controlType: "staticProp" },
    ],
  },
  setUnselectableObjectIds: vi.fn(),
  setUnpickableObjects: vi.fn(),
}));

vi.mock("../hooks/use-console-nav", () => ({ useConsoleNav: () => ({ activeNav: state.activeNav }) }));
vi.mock("../hooks/use-project-store", () => ({ useProjectStore: () => ({ objects: state.objects }) }));
vi.mock("../hooks/use-selection", () => ({ useSelection: () => ({ setUnselectableObjectIds }) }));
vi.mock("./Viz3DProvider", () => ({ useViz3DContext: () => ({ setUnpickableObjects }) }));

import { PlaceholderSelectionSync, placeholderIdsForNav } from "./PlaceholderSelectionSync";

afterEach(() => {
  cleanup();
  setUnselectableObjectIds.mockClear();
  setUnpickableObjects.mockClear();
});

describe("placeholder selection", () => {
  it("locks placeholders on the control and action pages only", () => {
    const objects = state.objects as Parameters<typeof placeholderIdsForNav>[1];
    expect(placeholderIdsForNav("control", objects)).toEqual([2]);
    expect(placeholderIdsForNav("sequences", objects)).toEqual([2]);
    expect(placeholderIdsForNav("devices", objects)).toEqual([]);
  });

  it("hands them to the selection state and the 3D picking", () => {
    const { rerender } = render(<PlaceholderSelectionSync />);
    expect([...setUnselectableObjectIds.mock.lastCall![0]]).toEqual([2]);
    expect(setUnpickableObjects).toHaveBeenLastCalledWith(["2"]);

    state.activeNav = "devices";
    rerender(<PlaceholderSelectionSync />);
    expect(setUnselectableObjectIds.mock.lastCall![0].size).toBe(0);
    expect(setUnpickableObjects).toHaveBeenLastCalledWith([]);
    state.activeNav = "control";
  });
});
