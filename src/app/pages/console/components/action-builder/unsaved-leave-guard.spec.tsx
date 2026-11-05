// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type MutableRefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveAllResult } from "./action-builder-context-types";
import { UnsavedLeaveGuard, type UnsavedLeaveGuard as Guard } from "./unsaved-leave-guard";

const { saveAllResult, handleSaveAll } = vi.hoisted(() => {
  const saveAllResult = { current: { saved: 1, blocked: [], running: [] } as SaveAllResult };
  return { saveAllResult, handleSaveAll: vi.fn(() => saveAllResult.current) };
});

vi.mock("@/app/project/project-motion-readiness", () => ({
  getSequenceContentRepairIssue: () => null,
}));

vi.mock("@/app/project/use-project", () => ({
  useProject: () => ({ currentProject: { document: {} } }),
}));

vi.mock("./use-action-builder", () => ({
  useActionBuilder: () => ({
    sequences: [{ id: 1, name: "开场" }],
    draftSequenceIds: new Set([1]),
    handleSaveAll,
  }),
}));

const openGuard = () => {
  const guardRef = createRef<Guard | null>() as MutableRefObject<Guard | null>;
  render(<UnsavedLeaveGuard guardRef={guardRef} />);
  const proceed = vi.fn();
  act(() => {
    guardRef.current?.(proceed);
  });
  return proceed;
};

describe("UnsavedLeaveGuard", () => {
  beforeEach(() => {
    saveAllResult.current = { saved: 1, blocked: [], running: [] };
    handleSaveAll.mockClear();
  });

  afterEach(cleanup);

  it("saves everything and leaves", () => {
    const proceed = openGuard();
    fireEvent.click(screen.getByRole("button", { name: "全部保存" }));
    expect(handleSaveAll).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("stays open when a draft could not be saved because its action is running", () => {
    saveAllResult.current = { saved: 0, blocked: [], running: ["开场"] };
    const proceed = openGuard();
    fireEvent.click(screen.getByRole("button", { name: "全部保存" }));
    expect(handleSaveAll).toHaveBeenCalledTimes(1);
    expect(proceed).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "暂不保存" }));
    expect(proceed).toHaveBeenCalledTimes(1);
  });
});
