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

/** 只有位置、没有 modelStatus 的遥测 */
const snapshotOf = (id: number, h: number): ControlledObjectSnapshot =>
  ({
    descriptor: { id, name: `obj${id}`, status: "ready" },
    positions: { h },
    modelStatus: null,
  }) as ControlledObjectSnapshot;

/** C++ modelStatus：16 静止 / 17 运动 */
const IDLE = 16;
const RUNNING = 17;

const frameOf = (id: number, h: number, modelStatus: number): ControlledObjectSnapshot =>
  ({
    descriptor: { id, name: `obj${id}`, status: modelStatus === RUNNING ? "running" : "ready" },
    positions: { h },
    modelStatus,
    live: true,
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

/** 遥测约 0.43 s 一帧，且主进程只转发数值有变化的帧 */
const FRAME_MS = 430;

beforeEach(() => {
  vi.useFakeTimers();
  live.snapshots = [snapshotOf(1, 100)];
  moveTargetModel.mockClear();
  window.csocketApi = { moveTargetModel } as unknown as Window["csocketApi"];
});

afterEach(() => {
  vi.useRealTimers();
  delete window.csocketApi;
});

const targetsOf = (state: ReturnType<typeof useGoReady>["state"]) =>
  state.entries.map((entry) => [entry.objectId, entry.target.v1, entry.dispatched === true]);

const pushFrame = (rerender: () => void, snapshots: ControlledObjectSnapshot[]) => {
  act(() => {
    vi.advanceTimersByTime(FRAME_MS);
  });
  live.snapshots = snapshots;
  rerender();
};

/** 之后不再有遥测帧（物体静止时主进程一帧都不转发） */
const waitQuietly = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

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

    // 遥测不报 modelStatus：在容差内停够一段时间算到位，回到位姿目标，影子不消失
    pushFrame(rerender, [snapshotOf(1, 410)]);
    waitQuietly(5_000);
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

describe("GO marker clears when the motion is over", () => {
  const armAndGo = async (
    result: { current: ReturnType<typeof useGoReady> },
    targets: Record<string, number>,
  ) => {
    act(() =>
      result.current.arm(
        Object.entries(targets).map(([objectId, v1]) => ({ objectId, target: { v1 }, current: { v1: 100 } })),
        "abs",
      ),
    );
    await act(async () => {
      await result.current.go(Object.keys(targets));
    });
    expect(result.current.state.phase).toBe("moving");
  };

  beforeEach(() => {
    live.snapshots = [frameOf(1, 100, IDLE), frameOf(2, 0, IDLE)];
  });

  it("clears once the device stops at the target, although telemetry then goes quiet", async () => {
    const { result, rerender } = renderHook(() => useGoReady(), { wrapper });
    await armAndGo(result, { "1": 410 });

    // 减速进容差、停下（状态变静止），之后物体不动就再也没有帧
    pushFrame(rerender, [frameOf(1, 300, RUNNING), frameOf(2, 0, IDLE)]);
    pushFrame(rerender, [frameOf(1, 409.6, RUNNING), frameOf(2, 0, IDLE)]);
    pushFrame(rerender, [frameOf(1, 410, IDLE), frameOf(2, 0, IDLE)]);
    waitQuietly(5_000);

    expect(result.current.state.phase).toBe("idle");
    expect(result.current.state.entries).toEqual([]);
  });

  it("clears right away when the device reports idle at the target after the start grace", async () => {
    const { result, rerender } = renderHook(() => useGoReady(), { wrapper });
    await armAndGo(result, { "1": 410 });

    pushFrame(rerender, [frameOf(1, 200, RUNNING), frameOf(2, 0, IDLE)]);
    pushFrame(rerender, [frameOf(1, 300, RUNNING), frameOf(2, 0, IDLE)]);
    pushFrame(rerender, [frameOf(1, 380, RUNNING), frameOf(2, 0, IDLE)]);
    pushFrame(rerender, [frameOf(1, 410, IDLE), frameOf(2, 0, IDLE)]);

    expect(result.current.state.phase).toBe("idle");
  });

  it("clears when the move ends short of the target (停止 / limit / alarm)", async () => {
    const { result, rerender } = renderHook(() => useGoReady(), { wrapper });
    await armAndGo(result, { "1": 410 });

    pushFrame(rerender, [frameOf(1, 200, RUNNING), frameOf(2, 0, IDLE)]);
    pushFrame(rerender, [frameOf(1, 230, RUNNING), frameOf(2, 0, IDLE)]);
    pushFrame(rerender, [frameOf(1, 250, RUNNING), frameOf(2, 0, IDLE)]);
    // 按了停止：停在 262，不在容差内
    pushFrame(rerender, [frameOf(1, 262, IDLE), frameOf(2, 0, IDLE)]);

    expect(result.current.state.phase).toBe("idle");
  });

  it("clears a GO to where the device already is, with no telemetry frame after the dispatch", async () => {
    live.snapshots = [frameOf(1, 410, IDLE), frameOf(2, 0, IDLE)];
    const { result } = renderHook(() => useGoReady(), { wrapper });
    await armAndGo(result, { "1": 410 });

    waitQuietly(5_000);

    expect(result.current.state.phase).toBe("idle");
  });

  it("clears each object's marker when that object is done, not only when all are", async () => {
    const { result, rerender } = renderHook(() => useGoReady(), { wrapper });
    await armAndGo(result, { "1": 410, "2": 50 });

    pushFrame(rerender, [frameOf(1, 300, RUNNING), frameOf(2, 10, RUNNING)]);
    pushFrame(rerender, [frameOf(1, 405, RUNNING), frameOf(2, 15, RUNNING)]);
    pushFrame(rerender, [frameOf(1, 410, IDLE), frameOf(2, 20, RUNNING)]);
    pushFrame(rerender, [frameOf(1, 410, IDLE), frameOf(2, 25, RUNNING)]);

    expect(result.current.state.phase).toBe("moving");
    expect(targetsOf(result.current.state)).toEqual([["2", 50, true]]);

    pushFrame(rerender, [frameOf(1, 410, IDLE), frameOf(2, 50, IDLE)]);
    expect(result.current.state.phase).toBe("idle");
  });

  it("keeps the marker while the device is still running, and during the start grace", async () => {
    const { result, rerender } = renderHook(() => useGoReady(), { wrapper });
    await armAndGo(result, { "1": 410 });

    // 刚下发：遥测还报静止、没动
    waitQuietly(1_000);
    expect(result.current.state.phase).toBe("moving");

    pushFrame(rerender, [frameOf(1, 150, RUNNING), frameOf(2, 0, IDLE)]);
    waitQuietly(60_000);
    expect(result.current.state.phase).toBe("moving");
    expect(targetsOf(result.current.state)).toEqual([["1", 410, true]]);
  });

  it("keeps a target re-set while the GO ack is pending as not yet dispatched", async () => {
    let resolveAck: (value: { success: boolean }) => void = () => {};
    moveTargetModel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAck = resolve;
        }),
    );
    const { result } = renderHook(() => useGoReady(), { wrapper });
    act(() => result.current.arm([{ objectId: "1", target: { v1: 410 }, current: { v1: 100 } }], "abs"));
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.go(["1"]);
    });
    // 等 GO 应答时改了目标：新目标没下发，不能标成执行中
    act(() => result.current.arm([{ objectId: "1", target: { v1: 420 }, current: { v1: 100 } }], "abs"));
    await act(async () => {
      resolveAck({ success: true });
      await pending;
    });

    expect(result.current.state.phase).toBe("armed");
    expect(targetsOf(result.current.state)).toEqual([["1", 420, false]]);
  });
});
