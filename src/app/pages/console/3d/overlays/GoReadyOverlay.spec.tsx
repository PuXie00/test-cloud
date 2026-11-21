// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoPlan } from "../../hooks/go-motion";
import { GoReadyOverlay } from "./GoReadyOverlay";

const { state } = vi.hoisted(() => ({
  state: {
    plan: null as unknown as GoPlan,
    timing: { kind: "default" } as { kind: string; durationMs?: number },
    go: vi.fn(),
    cancel: vi.fn(),
    setTiming: vi.fn(),
    setDirection: vi.fn(),
  },
}));

vi.mock("../../hooks/go-ready-provider", () => ({
  useGoReady: () => ({
    state: {
      phase: "armed",
      mode: "abs",
      entries: [
        { objectId: "1", target: { v1: 400 }, current: { v1: 0 } },
        { objectId: "9", target: { v1: 350 }, current: { v1: 10 } },
      ],
    },
    go: state.go,
    cancel: state.cancel,
    timing: state.timing,
    setTiming: state.setTiming,
    setDirection: state.setDirection,
    plan: state.plan,
  }),
}));
vi.mock("../../hooks/use-console-nav", () => ({ useConsoleNav: () => ({ activeNav: "sequences" }) }));
vi.mock("../../hooks/use-project-store", () => ({
  useProjectStore: () => ({ objects: [{ id: 1, name: "升降台-01" }, { id: 9, name: "转台" }] }),
}));
vi.mock("../../components/action-builder/use-action-builder", () => ({
  useActionBuilder: () => ({ sequence: null, selection: null, liveMode: true, handleSelectionChange: vi.fn() }),
}));

const plan = (overrides: Partial<GoPlan> = {}): GoPlan => ({
  objects: [
    { objectId: "1", direction: 0, axes: {}, defaultSeconds: 5, fastestSeconds: 2, seconds: 5 },
    { objectId: "9", direction: 2, axes: {}, defaultSeconds: 2, fastestSeconds: 1, seconds: 2 },
  ],
  totalSeconds: 5,
  slowestId: "1",
  ...overrides,
});

beforeEach(() => {
  state.plan = plan();
  state.timing = { kind: "default" };
  for (const fn of [state.go, state.cancel, state.setTiming, state.setDirection]) fn.mockClear();
});
afterEach(cleanup);

describe("GO bar", () => {
  it("says how long GO takes and which object is slowest, without listing every object", () => {
    render(<GoReadyOverlay />);
    expect(screen.getByText("GO 准备 · 2 个物体")).not.toBeNull();
    expect(screen.getByText("约 5.0 s")).not.toBeNull();
    expect(screen.getByText("升降台-01 最慢")).not.toBeNull();
    // 只有无极旋转单独一行（选转向），普通物体不逐台列出
    const turning = within(screen.getByRole("list", { name: "无极旋转转向" }));
    expect(turning.getAllByRole("listitem")).toHaveLength(1);
    expect(turning.getByText("转台")).not.toBeNull();
    expect(screen.queryByText("升降台-01", { exact: true })).toBeNull();
  });

  it("has no per-object rows when nothing turns", () => {
    state.plan = plan({ objects: [plan().objects[0]!] });
    render(<GoReadyOverlay />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/最慢/)).toBeNull();
  });

  it("lets a continuous rotation turn the other way", () => {
    render(<GoReadyOverlay />);
    const turn = within(screen.getByRole("group", { name: "转台 转向" }));
    expect(turn.getByRole("button", { name: "反转" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(turn.getByRole("button", { name: "正转" }));
    expect(state.setDirection).toHaveBeenCalledWith("9", 1);
  });

  it("switches to arriving together or a set time, starting from the current time", () => {
    render(<GoReadyOverlay />);
    const modes = within(screen.getByRole("group", { name: "走法" }));
    fireEvent.click(modes.getByRole("button", { name: "同时到达" }));
    expect(state.setTiming).toHaveBeenCalledWith({ kind: "sync" });
    fireEvent.click(modes.getByRole("button", { name: "指定时长" }));
    expect(state.setTiming).toHaveBeenLastCalledWith({ kind: "duration", durationMs: 5000 });
  });

  it("blocks GO with the reason when a set time is too short", () => {
    state.timing = { kind: "duration", durationMs: 1000 };
    state.plan = plan({ error: "太短了，最短 2.1 s" });
    render(<GoReadyOverlay />);
    expect(screen.getByText("太短了，最短 2.1 s")).not.toBeNull();
    expect((screen.getByRole("button", { name: "全部物体 GO" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("指定时长")).not.toBeNull();
  });
});
