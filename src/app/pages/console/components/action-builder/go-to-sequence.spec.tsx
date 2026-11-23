// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { useGoToSequence } from "./go-to-sequence";

const { state } = vi.hoisted(() => ({
  state: {
    setTargets: vi.fn(),
    setLiveMode: vi.fn(),
    handleSelectionChange: vi.fn(),
    positions: new Map<number, { h?: number; p?: number }>(),
    toastInfo: vi.fn(),
  },
}));

vi.mock("../../hooks/go-ready-provider", () => ({
  useOptionalGoReady: () => ({ setTargets: state.setTargets }),
}));
vi.mock("../../hooks/use-controlled-objects", () => ({
  useOptionalControlledObjects: () => ({
    getById: (id: number) => (state.positions.has(id) ? { positions: state.positions.get(id) } : undefined),
  }),
}));
vi.mock("./use-action-builder", () => ({
  useActionBuilder: () => ({ setLiveMode: state.setLiveMode, handleSelectionChange: state.handleSelectionChange }),
}));
vi.mock("sonner", () => ({ toast: { info: state.toastInfo, warning: vi.fn() } }));

// 物体 1 从 0 s、物体 2 从 3 s 开始；物体 3 不在线
const sequence: ActionSequenceConfig = {
  id: 5,
  name: "开场",
  trajectoryMode: false,
  blocks: [
    { id: "a1", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 100 } },
    { id: "a2", kind: "pose", objectId: 1, atMs: 4000, pose: { v1: 900 } },
    { id: "b1", kind: "pose", objectId: 2, atMs: 3000, pose: { v1: 50, v2: 10 } },
    { id: "c1", kind: "pose", objectId: 3, atMs: 1000, pose: { v1: 5 } },
  ],
  segments: [],
};

beforeEach(() => {
  for (const fn of [state.setTargets, state.setLiveMode, state.handleSelectionChange, state.toastInfo]) {
    fn.mockClear();
  }
  state.positions = new Map([
    [1, { h: 0 }],
    [2, { h: 40, p: 0 }],
  ]);
});

describe("去这里", () => {
  it("targets each object's own start, turns on 当前位置 and skips offline objects", () => {
    const { result } = renderHook(() => useGoToSequence());
    result.current!(sequence);
    expect(state.handleSelectionChange).toHaveBeenCalledWith(null);
    expect(state.setLiveMode).toHaveBeenCalledWith(true);
    // GO 条上写明是「开场」的起点
    const source = { kind: "sequence", name: "开场" };
    expect(state.setTargets).toHaveBeenCalledWith([
      { objectId: "1", target: { v1: 100 }, current: { v1: 0 }, source },
      { objectId: "2", target: { v1: 50, v2: 10 }, current: { v1: 40, v2: 0 }, source },
    ]);
    expect(state.toastInfo).toHaveBeenCalledWith("1 个物体不在线，已跳过");
  });
});
