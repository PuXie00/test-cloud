import { describe, expect, it } from "vitest";
import type { ControlledObjectSnapshot } from "../components/monitor-grid/monitor-data";
import {
  ARRIVAL_TOLERANCE,
  buildMoveTargetItem,
  goEntriesForObjectIds,
  goPhaseFromEntries,
  isArrived,
  markGoDispatched,
  pendingGoEntries,
  positionsToAxisValues,
  removeGoEntries,
  resolveGoTargets,
  type GoReadyEntry,
} from "./go-ready";

const snapshot = (
  id: number,
  positions: { h?: number; p?: number; y?: number } | null,
): ControlledObjectSnapshot =>
  ({
    descriptor: { id, name: `obj${id}` } as ControlledObjectSnapshot["descriptor"],
    positions,
  }) as ControlledObjectSnapshot;

describe("resolveGoTargets", () => {
  it("绝对模式：目标 = 输入值", () => {
    const entries = resolveGoTargets(
      [snapshot(1, { h: 100, p: 5, y: -3 })],
      { height: 250 },
      "abs",
    );
    expect(entries).toEqual([
      { objectId: "1", target: { v1: 250 }, current: { v1: 100, v2: 5, v3: -3 } },
    ]);
  });

  it("相对模式：目标 = 当前 + 增量", () => {
    const entries = resolveGoTargets(
      [snapshot(1, { h: 100, p: 5, y: -3 })],
      { height: 20, pitch: -2 },
      "rel",
    );
    expect(entries[0].target).toEqual({ v1: 120, v2: 3 });
  });

  it("相对模式：有已设目标时以目标为基准", () => {
    const entries = resolveGoTargets(
      [snapshot(1, { h: 100, p: 5 })],
      { height: 20 },
      "rel",
      { "1": { v1: 200 } },
    );
    expect(entries[0].target).toEqual({ v1: 220 });
  });

  it("相对模式：无目标且无监控值时跳过该轴", () => {
    expect(resolveGoTargets([snapshot(1, { h: 100 })], { pitch: 5 }, "rel")).toEqual([]);
    expect(resolveGoTargets([snapshot(1, { h: 100 })], { height: 5 }, "rel")[0]?.target).toEqual({
      v1: 105,
    });
  });

  it("绝对模式：positions 为 null 仍生成目标（不依赖当前值）", () => {
    const entries = resolveGoTargets([snapshot(1, null)], { height: 10 }, "abs");
    expect(entries).toEqual([{ objectId: "1", target: { v1: 10 }, current: {} }]);
  });

  it("相对模式：positions 为 null 时跳过（无当前值）", () => {
    expect(resolveGoTargets([snapshot(1, null)], { height: 10 }, "rel")).toEqual([]);
  });

  it("部分轴：绝对模式填写多维度时全部生成目标", () => {
    const entries = resolveGoTargets(
      [snapshot(1, { h: 100 })],
      { height: 250, pitch: 30 },
      "abs",
    );
    expect(entries[0].target).toEqual({ v1: 250, v2: 30 });
  });

  it("部分轴：相对模式仅对有监控值的维度生成目标", () => {
    const entries = resolveGoTargets(
      [snapshot(1, { h: 100 })],
      { height: 20, pitch: 5 },
      "rel",
    );
    expect(entries[0].target).toEqual({ v1: 120 });
  });
});

describe("positionsToAxisValues", () => {
  it("仅映射有值的轴", () => {
    expect(positionsToAxisValues({ h: 100, y: 3 })).toEqual({ v1: 100, v3: 3 });
    expect(positionsToAxisValues(null)).toEqual({});
  });
});

describe("isArrived", () => {
  it("各轴在容差内返回 true", () => {
    expect(isArrived({ v1: 100, v2: 5 }, { v1: 100, v2: 5 }, ARRIVAL_TOLERANCE)).toBe(true);
  });

  it("单轴超容差返回 false", () => {
    expect(isArrived({ v1: 102 }, { v1: 100 }, ARRIVAL_TOLERANCE)).toBe(false);
    expect(isArrived({ v1: 100 }, { v1: 100 }, ARRIVAL_TOLERANCE)).toBe(true);
  });

  it("目标轴缺当前值返回 false", () => {
    expect(isArrived({}, { v1: 100 }, ARRIVAL_TOLERANCE)).toBe(false);
  });
});

describe("go dispatch helpers", () => {
  const entries: GoReadyEntry[] = [
    { objectId: "1", target: { v1: 10 }, current: {}, dispatched: false },
    { objectId: "2", target: { v1: 20 }, current: {}, dispatched: true },
    { objectId: "3", target: { v1: 30 }, current: {} },
  ];

  it("pendingGoEntries 排除已下发", () => {
    expect(pendingGoEntries(entries).map((entry) => entry.objectId)).toEqual(["1", "3"]);
  });

  it("goEntriesForObjectIds 按 id 过滤", () => {
    expect(goEntriesForObjectIds(entries, ["2", "9"]).map((entry) => entry.objectId)).toEqual(["2"]);
  });

  it("markGoDispatched 只标记指定物体", () => {
    expect(markGoDispatched(entries, ["1"]).map((entry) => [entry.objectId, Boolean(entry.dispatched)])).toEqual([
      ["1", true],
      ["2", true],
      ["3", false],
    ]);
  });

  it("removeGoEntries 删除指定物体", () => {
    expect(removeGoEntries(entries, ["2", "3"]).map((entry) => entry.objectId)).toEqual(["1"]);
  });

  it("goPhaseFromEntries 按是否仍有未下发条目判定", () => {
    expect(goPhaseFromEntries([])).toBe("idle");
    expect(goPhaseFromEntries(entries)).toBe("armed");
    expect(goPhaseFromEntries(markGoDispatched(entries, ["1", "3"]))).toBe("moving");
  });
});

describe("buildMoveTargetItem", () => {
  it("映射 v1/v2/v3 到 h/p/y，缺轴与速度加减速度为 0", () => {
    const item = buildMoveTargetItem({ objectId: "1", target: { v1: 250, v2: -5 }, current: {} });
    expect(item).toEqual({
      deviceId: 1,
      hTargetPosition: 250,
      hVelocity: 0,
      hAcceleration: 0,
      hDeceleration: 0,
      pTargetPosition: -5,
      pVelocity: 0,
      pAcceleration: 0,
      pDeceleration: 0,
      yTargetPosition: 0,
      yVelocity: 0,
      yAcceleration: 0,
      yDeceleration: 0,
      moveDirection: 0,
    });
    expect(item).not.toHaveProperty("hPositionSign");
    expect(item).not.toHaveProperty("pPositionSign");
    expect(item).not.toHaveProperty("yPositionSign");
  });
});
