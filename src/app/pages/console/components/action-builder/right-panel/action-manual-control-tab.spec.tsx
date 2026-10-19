// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { ActionManualControlTab } from "./action-manual-control-tab";

type PanelProps = {
  objectIds?: readonly number[];
  liveLabel?: string | null;
  saveLabel?: string;
  saveBlockedReason?: string | null;
  onSaveCurrentPose: (request: { objectIds: readonly number[] }) => void;
};

const { state } = vi.hoisted(() => ({
  state: {
    builder: {} as Record<string, unknown>,
    snapshots: new Map<number, unknown>(),
    goEntries: [] as unknown[],
    bind: vi.fn(),
    panel: null as PanelProps | null,
  },
}));

vi.mock("../use-action-builder", () => ({ useActionBuilder: () => state.builder }));
vi.mock("../../../hooks/use-controlled-objects", () => ({
  useControlledObjects: () => ({ getById: (id: number) => state.snapshots.get(id) }),
}));
vi.mock("../../../hooks/use-project-store", () => ({ useProjectStore: () => ({ objects: [] }) }));
vi.mock("../../../hooks/go-ready-provider", () => ({
  useGoReady: () => ({ state: { phase: "armed", mode: "abs", entries: state.goEntries }, bind: state.bind }),
}));
vi.mock("../../right-tab-panel/manual-control-tab/manual-control-panel", () => ({
  ManualControlPanel: (props: PanelProps) => {
    state.panel = props;
    return null;
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: false,
  blocks: [
    { id: "a", kind: "pose", objectId: 7, atMs: 4000, pose: { v1: 400 } },
    { id: "b", kind: "pose", objectId: 8, atMs: 4000, pose: { v1: 500, v2: 10 } },
    { id: "c", kind: "pose", objectId: 7, atMs: 6000, pose: { v1: 600 } },
  ],
  segments: [],
};

const snapshot = (id: number, positions: { h?: number; p?: number }, status = "ready") => ({
  descriptor: {
    id,
    name: `obj${id}`,
    status,
    dimensions: [
      { key: "height", label: "升降", unit: "mm" },
      ...(id === 8 ? [{ key: "pitch", label: "摆动 X", unit: "°" }] : []),
    ],
  },
  positions,
});

const handleSaveCurrentPose = vi.fn();
const handleUpdatePosesFromLive = vi.fn();

const setBuilder = (selection: unknown) => {
  state.builder = {
    sequence,
    selection,
    cursorMs: 2500,
    handleSaveCurrentPose,
    handleUpdatePosesFromLive,
  };
};

beforeEach(() => {
  state.snapshots = new Map<number, unknown>([
    [7, snapshot(7, { h: 403.5 })],
    [8, snapshot(8, { h: 498, p: 2 })],
  ]);
  state.goEntries = [];
  state.bind.mockClear();
  state.panel = null;
  handleSaveCurrentPose.mockClear();
  handleUpdatePosesFromLive.mockClear();
});

afterEach(cleanup);

describe("ActionManualControlTab live pose editing", () => {
  it("binds the selected poses as GO targets and writes the live position back on 取当前", () => {
    setBuilder({ kind: "multi-block", blockIds: ["a", "b"] });
    const { unmount } = render(<ActionManualControlTab />);

    const bindings = state.bind.mock.calls.at(-1)?.[0] as Map<string, { target: unknown }>;
    expect([...bindings.entries()].map(([id, binding]) => [id, binding.target])).toEqual([
      ["7", { v1: 400 }],
      // 物体 8 的虚轴2 设定了 10
      ["8", { v1: 500, v2: 10 }],
    ]);
    expect(state.panel).toMatchObject({
      objectIds: [7, 8],
      liveLabel: "联机编辑 4.0 s 的 2 个位姿",
      saveLabel: "取当前 → 更新 2 个位姿",
      saveBlockedReason: null,
    });

    state.panel!.onSaveCurrentPose({ objectIds: [7, 8] });
    expect(handleSaveCurrentPose).not.toHaveBeenCalled();
    const [blockIds, liveFor] = handleUpdatePosesFromLive.mock.calls[0]!;
    expect(blockIds).toEqual(["a", "b"]);
    expect(liveFor(8)).toEqual({ v1: 498, v2: 2 });

    unmount();
    expect(state.bind).toHaveBeenLastCalledWith(null);
  });

  it("blocks 取当前 while a bound device moves or two poses share an object", () => {
    setBuilder({ kind: "block", blockId: "a" });
    state.snapshots.set(7, snapshot(7, { h: 380 }, "running"));
    render(<ActionManualControlTab />);
    expect(state.panel?.saveBlockedReason).toBe("设备运动中，停稳后再取当前");
    cleanup();

    // 刚按 GO、遥测还没报运动
    state.snapshots.set(7, snapshot(7, { h: 380 }));
    state.goEntries = [
      { objectId: "7", target: { v1: 400 }, current: {}, dispatched: true, dispatchedAt: Date.now() },
    ];
    render(<ActionManualControlTab />);
    expect(state.panel?.saveBlockedReason).toBe("设备运动中，停稳后再取当前");
    cleanup();

    // 早就下发、遥测已经静止（没走到容差内）也可以取当前
    state.goEntries = [
      { objectId: "7", target: { v1: 400 }, current: {}, dispatched: true, dispatchedAt: Date.now() - 5000 },
    ];
    render(<ActionManualControlTab />);
    expect(state.panel?.saveBlockedReason).toBeNull();
    cleanup();

    state.goEntries = [];
    setBuilder({ kind: "multi-block", blockIds: ["a", "c"] });
    render(<ActionManualControlTab />);
    expect(state.panel?.saveBlockedReason).toBe(
      "同一物体选了多个时刻的位姿，联机时每个物体只能选一个",
    );
    expect(state.panel?.objectIds).toBeUndefined();
    expect(state.bind).toHaveBeenLastCalledWith(null);
  });

  it("without selected poses saves at the playhead as before", () => {
    setBuilder(null);
    render(<ActionManualControlTab />);
    expect(state.panel).toMatchObject({ saveLabel: "取当前 → 写入 2.5 s", liveLabel: null });
    state.panel!.onSaveCurrentPose({ objectIds: [7] });
    expect(handleSaveCurrentPose).toHaveBeenCalledWith({ objectIds: [7] });
    expect(handleUpdatePosesFromLive).not.toHaveBeenCalled();
  });
});
