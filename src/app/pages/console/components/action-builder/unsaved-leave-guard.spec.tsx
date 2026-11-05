// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type MutableRefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnsavedLeaveGuard, type UnsavedLeaveGuard as Guard } from "./unsaved-leave-guard";

const { motionLock, handleSaveAll } = vi.hoisted(() => ({
  motionLock: { action: null as string | null },
  handleSaveAll: vi.fn(() => ({ saved: 0, blocked: [] as string[] })),
}));

vi.mock("../../hooks/axis-motion", () => ({
  useAxisMotionLocks: () => ({ setup: null, action: motionLock.action, download: null }),
}));

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
    motionLock.action = null;
    handleSaveAll.mockClear();
  });

  afterEach(cleanup);

  it("saves everything and leaves", () => {
    const proceed = openGuard();
    fireEvent.click(screen.getByRole("button", { name: "全部保存" }));
    expect(handleSaveAll).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open when saving is refused while axes move", () => {
    motionLock.action = "1 个轴运动中，动作暂时不能保存";
    const proceed = openGuard();
    // 不常驻提示文字，按下才由 handleSaveAll 提示
    expect(screen.queryByText(motionLock.action)).toBeNull();
    const saveAll = screen.getByRole("button", { name: "全部保存" }) as HTMLButtonElement;
    expect(saveAll.disabled).toBe(false);

    fireEvent.click(saveAll);
    expect(handleSaveAll).toHaveBeenCalledTimes(1);
    expect(proceed).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "暂不保存" }));
    expect(proceed).toHaveBeenCalledTimes(1);
  });
});
