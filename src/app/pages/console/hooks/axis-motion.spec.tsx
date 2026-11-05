// @vitest-environment jsdom
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestPermissionsProvider } from "@/app/auth/permissions";
import type { PermissionId } from "@shared/auth/permissions";

const { setEditLock } = vi.hoisted(() => ({ setEditLock: vi.fn() }));
vi.mock("@/app/project/use-project", () => ({ useProject: () => ({ setEditLock }) }));

import {
  AxisMotionEditLockSync,
  AxisMotionProvider,
  ingestAxisStatusFrame,
  useAxisMotion,
  useSetupEditState,
} from "./axis-motion";

type Handler = (msg: unknown) => void;
let emitAxis: Handler = () => undefined;
let snapshot: unknown = { success: true, data: [] };
const offAxis = vi.fn();

const frame = (data: Record<string, number>[]) => ({ success: true, data });

const installApi = () => {
  (window as unknown as { csocketApi: unknown }).csocketApi = {
    onReadAxisInfoPolling: (cb: Handler) => {
      emitAxis = cb;
      return offAxis;
    },
    getAxisInfoSnapshot: async () => snapshot,
  };
};

beforeEach(() => {
  snapshot = { success: true, data: [] };
  offAxis.mockClear();
  setEditLock.mockClear();
  installApi();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { csocketApi?: unknown }).csocketApi;
});

describe("ingestAxisStatusFrame", () => {
  it("merges statuses by axis, clears on an empty frame and only fills gaps from a snapshot", () => {
    const status = new Map<number, number | undefined>();
    ingestAxisStatusFrame(status, frame([{ deviceId: 1, axisStatus: 3 }, { deviceId: 2, axisStatus: 2 }]));
    // 只有位置的帧不改状态
    ingestAxisStatusFrame(status, frame([{ deviceId: 1, actualPosition: 5 }]));
    expect([...status]).toEqual([[1, 3], [2, 2]]);

    ingestAxisStatusFrame(status, frame([{ deviceId: 1, axisStatus: 2 }, { deviceId: 3, axisStatus: 3 }]), true);
    expect([...status]).toEqual([[1, 3], [2, 2], [3, 3]]);

    ingestAxisStatusFrame(status, { success: false, data: [] });
    expect(status.size).toBe(3);
    ingestAxisStatusFrame(status, frame([]));
    expect(status.size).toBe(0);
  });
});

describe("AxisMotionProvider", () => {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(AxisMotionProvider, null, children);

  it("reports moving axes from the snapshot and live frames", async () => {
    snapshot = frame([{ deviceId: 7, axisStatus: 3 }]);
    const { result } = renderHook(() => useAxisMotion(), { wrapper });
    await waitFor(() => expect(result.current.movingAxisIds).toEqual([7]));

    act(() => emitAxis(frame([{ deviceId: 2, axisStatus: 3 }])));
    expect(result.current.movingAxisIds).toEqual([2, 7]);

    act(() => emitAxis(frame([{ deviceId: 7, axisStatus: 2 }, { deviceId: 2, axisStatus: 2 }])));
    expect(result.current.movingAxisIds).toEqual([]);
  });

  it("does not re-render on position-only updates", async () => {
    let renders = 0;
    const Probe = () => {
      renders += 1;
      useAxisMotion();
      return null;
    };
    render(createElement(AxisMotionProvider, null, createElement(Probe)));
    act(() => emitAxis(frame([{ deviceId: 1, axisStatus: 3, actualPosition: 0 }])));
    await act(async () => {});
    const settled = renders;
    for (let position = 1; position <= 20; position += 1) {
      act(() => emitAxis(frame([{ deviceId: 1, axisStatus: 3, actualPosition: position }])));
    }
    expect(renders).toBe(settled);
  });

  it("forgets the motion when the main process clears the axis cache", async () => {
    const { result } = renderHook(() => useAxisMotion(), { wrapper });
    act(() => emitAxis(frame([{ deviceId: 1, axisStatus: 3 }])));
    expect(result.current.movingAxisIds).toEqual([1]);
    act(() => emitAxis(frame([])));
    expect(result.current.movingAxisIds).toEqual([]);
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useAxisMotion(), { wrapper });
    unmount();
    expect(offAxis).toHaveBeenCalledTimes(1);
  });
});

describe("AxisMotionEditLockSync", () => {
  it("locks setup and action writes while axes move and releases them after", async () => {
    const { unmount } = render(
      createElement(AxisMotionProvider, null, createElement(AxisMotionEditLockSync)),
    );
    expect(setEditLock).toHaveBeenLastCalledWith("motion", null);

    act(() => emitAxis(frame([{ deviceId: 1, axisStatus: 3 }, { deviceId: 2, axisStatus: 3 }])));
    expect(setEditLock).toHaveBeenCalledWith("setup", "2 个轴运动中，搭建暂时只读");
    expect(setEditLock).toHaveBeenCalledWith("motion", "2 个轴运动中，动作暂时不能保存");

    act(() => emitAxis(frame([{ deviceId: 1, axisStatus: 2 }, { deviceId: 2, axisStatus: 2 }])));
    expect(setEditLock).toHaveBeenCalledWith("setup", null);

    setEditLock.mockClear();
    act(() => emitAxis(frame([{ deviceId: 1, axisStatus: 3 }])));
    unmount();
    expect(setEditLock).toHaveBeenCalledWith("setup", null);
    expect(setEditLock).toHaveBeenLastCalledWith("motion", null);
  });
});

describe("useSetupEditState", () => {
  const renderState = (permissions: PermissionId[]) =>
    renderHook(() => useSetupEditState(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <TestPermissionsProvider permissions={permissions}>
          <AxisMotionProvider>{children}</AxisMotionProvider>
        </TestPermissionsProvider>
      ),
    });

  it("is read-only without the edit permission and while an axis moves", () => {
    expect(renderState([]).result.current).toEqual({
      readOnly: true,
      reason: "只读：没有「编辑工程配置」权限",
    });
    cleanup();

    const { result } = renderState(["build.edit"]);
    expect(result.current).toEqual({ readOnly: false, reason: null });
    act(() => emitAxis(frame([{ deviceId: 3, axisStatus: 3 }])));
    expect(result.current).toEqual({ readOnly: true, reason: "1 个轴运动中，搭建暂时只读" });
  });
});
