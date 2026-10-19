// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlledObjectSnapshot } from "../components/monitor-grid/monitor-data";
import type { GoBinding } from "./go-ready";
import { GoReadyProvider, useGoReady } from "./go-ready-provider";

const { live } = vi.hoisted(() => ({
  live: { snapshots: [] as ControlledObjectSnapshot[] },
}));

const snapshotOf = (id: number, h: number): ControlledObjectSnapshot =>
  ({
    descriptor: { id, name: `obj${id}` },
    positions: { h },
  }) as ControlledObjectSnapshot;

vi.mock("./use-controlled-objects", () => ({
  useControlledObjects: () => ({
    snapshots: live.snapshots,
    getById: (id: number) => live.snapshots.find((item) => item.descriptor.id === id),
  }),
}));
vi.mock("./use-project-store", () => ({ useProjectStore: () => ({ objects: [{ id: 1 }, { id: 2 }] }) }));
vi.mock("./use-console-nav", () => ({ useConsoleNav: () => ({ activeNav: "sequences" }) }));
vi.mock("./use-console-mode", () => ({ useConsoleMode: () => ({ mode: "edit" }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const wrapper = ({ children }: { children: ReactNode }) => <GoReadyProvider>{children}</GoReadyProvider>;

const binding = (v1: number): GoBinding => ({ target: { v1 }, current: { v1: 100 } });

const moveTargetModel = vi.fn(async () => ({ success: true }));

beforeEach(() => {
  live.snapshots = [snapshotOf(1, 100)];
  moveTargetModel.mockClear();
  window.csocketApi = { moveTargetModel } as unknown as Window["csocketApi"];
});

afterEach(() => {
  delete window.csocketApi;
});

const targetsOf = (state: ReturnType<typeof useGoReady>["state"]) =>
  state.entries.map((entry) => [entry.objectId, entry.target.v1, entry.dispatched === true]);

describe("GO bound to selected poses", () => {
  it("keeps the shadow on the pose after arriving at a hand-set target", async () => {
    const { result, rerender } = renderHook(() => useGoReady(), { wrapper });
    act(() => result.current.bind(new Map([["1", binding(400)]])));
    expect(result.current.state.phase).toBe("armed");
    expect(targetsOf(result.current.state)).toEqual([["1", 400, false]]);

    // 维度控制改目标再 GO
    act(() => result.current.arm([{ objectId: "1", target: { v1: 410 }, current: { v1: 100 } }], "abs"));
    await act(async () => {
      await result.current.go(["1"]);
    });
    expect(moveTargetModel).toHaveBeenCalledWith([expect.objectContaining({ hTargetPosition: 410 })]);
    expect(targetsOf(result.current.state)).toEqual([["1", 410, true]]);

    // 连续 3 帧到位后回到位姿目标，影子不消失
    live.snapshots = [snapshotOf(1, 410)];
    for (let tick = 0; tick < 3; tick += 1) {
      live.snapshots = [...live.snapshots];
      rerender();
    }
    expect(result.current.state.phase).toBe("armed");
    expect(targetsOf(result.current.state)).toEqual([["1", 400, false]]);
  });

  it("clearing a bound object goes back to the pose, and unbinding drops it", () => {
    const { result } = renderHook(() => useGoReady(), { wrapper });
    act(() => result.current.bind(new Map([["1", binding(400)]])));
    act(() => result.current.arm([{ objectId: "1", target: { v1: 420 }, current: {} }], "abs"));
    act(() => result.current.arm([{ objectId: "2", target: { v1: 5 }, current: {} }], "abs"));

    act(() => result.current.cancel());
    expect(targetsOf(result.current.state)).toEqual([["1", 400, false]]);

    act(() => result.current.bind(null));
    expect(result.current.state.phase).toBe("idle");
  });
});
