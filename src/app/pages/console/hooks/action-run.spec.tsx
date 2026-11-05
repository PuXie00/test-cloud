// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setRunningSequenceIds, status } = vi.hoisted(() => ({
  setRunningSequenceIds: vi.fn(),
  status: { normal: true },
}));
vi.mock("@/app/project/use-project", () => ({ useProject: () => ({ setRunningSequenceIds }) }));
vi.mock("./plc-runtime-provider", () => ({ useSystemStatusNormal: () => status.normal }));

import {
  ActionRunEditLockSync,
  ActionRunProvider,
  ingestActionRunFrame,
  runningActionIdsAt,
  useRunningActionIds,
} from "./action-run";
import { ACTION_RUN_STALE_MS } from "./exec-card-run-status";

type Handler = (msg: unknown) => void;
let emitAct: Handler = () => undefined;
const offAct = vi.fn();

const report = (...actionIds: number[]) => ({
  success: true,
  data: actionIds.map((actionId) => ({ actionId, state: 3, loopCount: 1, loopCountSet: 1, runTime: 100 })),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  offAct.mockClear();
  setRunningSequenceIds.mockClear();
  (window as unknown as { csocketApi: unknown }).csocketApi = {
    onReadActionRun: (cb: Handler) => {
      emitAct = cb;
      return offAct;
    },
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as unknown as { csocketApi?: unknown }).csocketApi;
});

describe("running action ids", () => {
  it("keeps an action running until it has not been reported for the stale time", () => {
    const lastSeen = new Map<number, number>();
    ingestActionRunFrame(lastSeen, report(4, 2), 0);
    ingestActionRunFrame(lastSeen, { success: false, data: [{ actionId: 7, state: 3 }] }, 0);
    expect(runningActionIdsAt(lastSeen, ACTION_RUN_STALE_MS)).toEqual([2, 4]);
    ingestActionRunFrame(lastSeen, report(4), 500);
    expect(runningActionIdsAt(lastSeen, ACTION_RUN_STALE_MS + 1)).toEqual([4]);
    expect(runningActionIdsAt(lastSeen, 500 + ACTION_RUN_STALE_MS + 1)).toEqual([]);
  });
});

describe("ActionRunProvider", () => {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ActionRunProvider, null, children);

  it("reports running actions from Info|act and drops them once they go quiet", () => {
    const { result } = renderHook(() => useRunningActionIds(), { wrapper });
    expect(result.current.size).toBe(0);

    act(() => emitAct(report(5)));
    expect([...result.current]).toEqual([5]);

    // 运行中持续上报（约 50ms 一次）
    for (let i = 0; i < 30; i += 1) {
      act(() => {
        vi.advanceTimersByTime(50);
        emitAct(report(5));
      });
    }
    expect([...result.current]).toEqual([5]);

    act(() => {
      vi.advanceTimersByTime(ACTION_RUN_STALE_MS + 300);
    });
    expect(result.current.size).toBe(0);
    // 没有动作在运行时不留定时器
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not re-render while the same actions keep reporting", () => {
    let renders = 0;
    const Probe = () => {
      renders += 1;
      useRunningActionIds();
      return null;
    };
    render(createElement(ActionRunProvider, null, createElement(Probe)));
    act(() => emitAct(report(1)));
    const settled = renders;
    for (let i = 0; i < 10; i += 1) {
      act(() => {
        vi.advanceTimersByTime(50);
        emitAct(report(1));
      });
    }
    expect(renders).toBe(settled);
  });

  it("counts running actions only while the system status is normal", () => {
    const { result, rerender } = renderHook(() => useRunningActionIds(), { wrapper });
    act(() => emitAct(report(5)));
    expect([...result.current]).toEqual([5]);
    status.normal = false;
    rerender();
    expect(result.current.size).toBe(0);
    status.normal = true;
    rerender();
    expect([...result.current]).toEqual([5]);
  });

  it("unsubscribes and clears its timer on unmount", () => {
    const { unmount } = renderHook(() => useRunningActionIds(), { wrapper });
    act(() => emitAct(report(1)));
    unmount();
    expect(offAct).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("ActionRunEditLockSync", () => {
  it("hands the running actions to the project and clears them on unmount", () => {
    const { unmount } = render(
      createElement(ActionRunProvider, null, createElement(ActionRunEditLockSync)),
    );
    act(() => emitAct(report(3)));
    expect([...setRunningSequenceIds.mock.lastCall![0]]).toEqual([3]);
    unmount();
    expect(setRunningSequenceIds.mock.lastCall![0].size).toBe(0);
  });
});
