// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { LiveEditStrip } from "./live-edit";

const { state } = vi.hoisted(() => ({
  state: {
    builder: {} as Record<string, unknown>,
    goEntries: [] as unknown[],
    totalSeconds: null as number | null,
    selected: [] as number[],
  },
}));

vi.mock("../use-action-builder", () => ({ useActionBuilder: () => state.builder }));
vi.mock("../../../hooks/use-controlled-objects", () => ({
  useControlledObjects: () => ({
    getById: (id: number) => ({
      descriptor: { id, name: `obj${id}`, status: "ready", dimensions: [{ key: "height", label: "升降", unit: "mm" }] },
      positions: { h: 403.5 },
    }),
  }),
}));
vi.mock("../../../hooks/use-project-store", () => ({ useProjectStore: () => ({ objects: [] }) }));
vi.mock("../../../hooks/use-selection", () => ({
  useSelection: () => ({ selectedId: null, multiSelectedIds: state.selected }),
}));
vi.mock("@/app/auth/permissions", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("../../../hooks/go-ready-provider", () => ({
  useGoReady: () => ({
    state: { phase: "armed", mode: "abs", entries: state.goEntries },
    bind: vi.fn(),
    plan: { objects: [], totalSeconds: state.totalSeconds },
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: false,
  blocks: [{ id: "a", kind: "pose", objectId: 7, atMs: 4000, pose: { v1: 400 } }],
  segments: [],
};

const handleSaveCurrentPose = vi.fn();
const handleUpdatePosesFromLive = vi.fn();

beforeEach(() => {
  state.goEntries = [];
  state.totalSeconds = null;
  state.selected = [];
  handleSaveCurrentPose.mockClear();
  handleUpdatePosesFromLive.mockClear();
});
afterEach(cleanup);

const setBuilder = (selection: unknown) => {
  state.builder = { sequence, selection, cursorMs: 2500, handleSaveCurrentPose, handleUpdatePosesFromLive };
};

describe("live strip on the properties tab", () => {
  it("writes the live position into the selected pose and shows how long GO takes", () => {
    setBuilder({ kind: "block", blockId: "a" });
    state.goEntries = [{ objectId: "7", target: { v1: 400 }, current: { v1: 0 }, dispatched: false }];
    state.totalSeconds = 6.04;
    render(<LiveEditStrip />);
    expect(screen.getByText("联机编辑 4.0 s 的位姿")).not.toBeNull();
    expect(screen.getByText(/约 6\.0 s/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取当前 → 更新位姿" }));
    expect(handleUpdatePosesFromLive).toHaveBeenCalledWith(["a"], expect.any(Function));
  });

  it("writes at the playhead for the selected objects when no pose is selected", () => {
    setBuilder(null);
    state.selected = [7];
    const onSaveShape = vi.fn();
    render(<LiveEditStrip onSaveShape={onSaveShape} />);
    fireEvent.click(screen.getByRole("button", { name: "存为造型" }));
    expect(onSaveShape).toHaveBeenCalledWith(expect.objectContaining({ objectIds: [7] }));
    fireEvent.click(screen.getByRole("button", { name: "取当前 → 写入 2.5 s" }));
    expect(handleSaveCurrentPose).toHaveBeenCalledWith(expect.objectContaining({ objectIds: [7] }));
  });

  it("cannot write without selected objects", () => {
    setBuilder(null);
    render(<LiveEditStrip />);
    expect((screen.getByRole("button", { name: "取当前 → 写入 2.5 s" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
