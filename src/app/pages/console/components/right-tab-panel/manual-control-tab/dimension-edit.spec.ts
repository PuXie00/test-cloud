import { describe, expect, it } from "vitest";
import type { VirtualAxisValues } from "@/app/project/project-document-types";
import type {
  ControlledObjectSnapshot,
  DimensionDescriptor,
} from "../../monitor-grid/monitor-data";
import type { AxisRangeSource } from "./dimension-axis-range";
import {
  axisInputRange,
  axisUnit,
  buildDimensionEntries,
  buildDimensionParticipants,
  sharedAxisValue,
  unionAxes,
} from "./dimension-edit";

const HEIGHT: DimensionDescriptor = { key: "height", label: "升降", unit: "mm" };
const ANGLE: DimensionDescriptor = { key: "angle", label: "旋转", unit: "°" };
const PITCH: DimensionDescriptor = { key: "pitch", label: "摆动 X", unit: "°" };
const YAW: DimensionDescriptor = { key: "yaw", label: "摆动 Y", unit: "°" };

const snapshot = (
  id: number,
  dimensions: DimensionDescriptor[],
  positions: { h?: number; p?: number; y?: number } | null = null,
): ControlledObjectSnapshot =>
  ({
    descriptor: { id, name: `obj${id}`, dimensions },
    positions,
  }) as unknown as ControlledObjectSnapshot;

const object = (
  id: number,
  ranges: { h?: [number, number]; p?: [number, number]; y?: [number, number] } = {},
): AxisRangeSource => ({
  id,
  controlType: "fourPointSwing",
  motionParams: Object.fromEntries(
    Object.entries(ranges).map(([key, [minAngle, maxAngle]]) => [key, { minAngle, maxAngle }]),
  ),
});

/** 1 号：升降（v1）；2 号：四点摆（v1 v2 v3） */
const liftAndSwing = (positions?: {
  lift?: { h?: number } | null;
  swing?: { h?: number; p?: number; y?: number } | null;
}) =>
  buildDimensionParticipants(
    [
      snapshot(1, [HEIGHT], positions?.lift ?? null),
      snapshot(2, [HEIGHT, PITCH, YAW], positions?.swing ?? null),
    ],
    [object(1, { h: [0, 1000] }), object(2, { h: [0, 500], p: [-30, 30], y: [-20, 20] })],
  );

describe("buildDimensionParticipants", () => {
  it("按虚轴 id 记录每个物体的轴、单位和行程", () => {
    const [lift, swing] = liftAndSwing();
    expect(lift?.axes).toEqual(["v1"]);
    expect(swing?.axes).toEqual(["v1", "v2", "v3"]);
    expect(swing?.unitByAxis).toEqual({ v1: "mm", v2: "°", v3: "°" });
    expect(swing?.ranges.v2).toEqual({ min: -30, max: 30 });
    expect(lift?.objectId).toBe("1");
  });

  it("没有虚轴的物体（轨道车、静态物体）不参与任何轴", () => {
    const participants = buildDimensionParticipants([snapshot(3, [])], [object(3)]);
    expect(unionAxes(participants)).toEqual([]);
  });
});

describe("显示", () => {
  it("显示所选物体虚轴的并集，而不是交集", () => {
    expect(unionAxes(liftAndSwing())).toEqual(["v1", "v2", "v3"]);
    expect(unionAxes(liftAndSwing().slice(0, 1))).toEqual(["v1"]);
  });

  it("单位只在会被写入的物体都一致时显示", () => {
    expect(axisUnit(liftAndSwing(), "v1")).toBe("mm");
    // 虚轴 2 只有四点摆有，升降灯架不参与
    expect(axisUnit(liftAndSwing(), "v2")).toBe("°");
    const mixed = buildDimensionParticipants(
      [snapshot(1, [HEIGHT]), snapshot(2, [ANGLE])],
      [object(1), object(2)],
    );
    expect(axisUnit(mixed, "v1")).toBeUndefined();
  });

  it("绝对输入的上下限是各物体行程的交集；没有交集或没有行程则不设", () => {
    expect(axisInputRange(liftAndSwing(), "v1")).toEqual({ min: 0, max: 500 });
    expect(axisInputRange(liftAndSwing(), "v2")).toEqual({ min: -30, max: 30 });
    const apart = buildDimensionParticipants(
      [snapshot(1, [HEIGHT]), snapshot(2, [HEIGHT])],
      [object(1, { h: [0, 100] }), object(2, { h: [200, 300] })],
    );
    expect(axisInputRange(apart, "v1")).toEqual({});
    const noRange = buildDimensionParticipants([snapshot(1, [HEIGHT])], [object(1)]);
    expect(axisInputRange(noRange, "v1")).toEqual({});
  });

  it("绝对值：没设目标取当前位置，各物体一致显示该值", () => {
    const participants = liftAndSwing({ lift: { h: 100 }, swing: { h: 100, p: 5, y: -3 } });
    expect(sharedAxisValue(participants, "v1", {})).toBe(100);
    expect(sharedAxisValue(participants, "v2", {})).toBe(5);
    expect(sharedAxisValue(participants, "v3", {})).toBe(-3);
  });

  it("绝对值：各物体位置不一致显示 --（undefined）", () => {
    const participants = liftAndSwing({ lift: { h: 100 }, swing: { h: 250, p: 5, y: -3 } });
    expect(sharedAxisValue(participants, "v1", {})).toBe(undefined);
  });

  it("绝对值：按一位小数取整后一致就算一致，-0 显示成 0", () => {
    const close = liftAndSwing({ lift: { h: 100.04 }, swing: { h: 100.02, p: -0.01, y: 0 } });
    expect(sharedAxisValue(close, "v1", {})).toBe(100);
    expect(Object.is(sharedAxisValue(close, "v2", {}), 0)).toBe(true);
  });

  it("绝对值：没有位置数据的物体让显示变成 --", () => {
    const participants = liftAndSwing({ lift: null, swing: { h: 100, p: 5, y: -3 } });
    expect(sharedAxisValue(participants, "v1", {})).toBe(undefined);
    // 虚轴 2 只有四点摆有，升降灯架没数据不影响
    expect(sharedAxisValue(participants, "v2", {})).toBe(5);
  });

  it("绝对值：已设 GO 目标的物体显示目标，其余物体仍显示当前位置", () => {
    const participants = liftAndSwing({ lift: { h: 100 }, swing: { h: 300, p: 5, y: -3 } });
    expect(sharedAxisValue(participants, "v1", { "1": { v1: 300 } })).toBe(300);
    expect(sharedAxisValue(participants, "v1", { "1": { v1: 200 } })).toBe(undefined);
    expect(
      sharedAxisValue(participants, "v1", { "1": { v1: 300 }, "2": { v1: 300, v2: 5, v3: -3 } }),
    ).toBe(300);
  });

  it("绝对值：目标里没有这根轴时回到当前位置", () => {
    const participants = liftAndSwing({ lift: { h: 100 }, swing: { h: 100, p: 5, y: -3 } });
    expect(sharedAxisValue(participants, "v1", { "1": {}, "2": { v2: 9 } })).toBe(100);
  });

  it("绝对值只看有这根虚轴的物体", () => {
    // 升降灯架没有虚轴 2，它的目标不影响虚轴 2 的显示
    const participants = liftAndSwing({ lift: { h: 1 }, swing: { h: 1, p: 7, y: 0 } });
    expect(sharedAxisValue(participants, "v2", { "1": { v1: 9 } })).toBe(7);
  });
});

describe("buildDimensionEntries 绝对模式", () => {
  it("所有有这根轴的物体写同一个值，没有这根轴的物体不写", () => {
    const { entries } = buildDimensionEntries(liftAndSwing(), { mode: "abs", axis: "v2", value: 10 });
    expect(entries.map((entry) => entry.objectId)).toEqual(["2"]);
    expect(entries[0]?.target.v2).toBe(10);
  });

  it("每个物体按自己的行程截断", () => {
    const { entries } = buildDimensionEntries(liftAndSwing(), { mode: "abs", axis: "v1", value: 800 });
    expect(entries.map((entry) => [entry.objectId, entry.target.v1])).toEqual([
      ["1", 800],
      ["2", 500],
    ]);
  });

  it("第一次进入 GO 准备时其余虚轴保持当前位置，和输入框里看到的一致", () => {
    const participants = liftAndSwing({ swing: { h: 80, p: 5, y: -3 } });
    const { entries } = buildDimensionEntries(participants, { mode: "abs", axis: "v1", value: 100 });
    expect(entries[1]?.target).toEqual({ v1: 100, v2: 5, v3: -3 });
    expect(entries[0]?.target).toEqual({ v1: 100 });
  });

  it("其余虚轴没有位置数据时不写（没有可保持的值）", () => {
    const participants = liftAndSwing({ swing: { h: 80 } });
    const { entries } = buildDimensionEntries(participants, { mode: "abs", axis: "v1", value: 100 });
    expect(entries[1]?.target).toEqual({ v1: 100 });
  });

  it("已经设过目标的物体只改这一根轴，不动其他轴", () => {
    const armed: Record<string, VirtualAxisValues> = { "2": { v1: 100, v2: 12, v3: -4 } };
    const { entries } = buildDimensionEntries(
      liftAndSwing(),
      { mode: "abs", axis: "v1", value: 50 },
      armed,
    );
    expect(entries.find((entry) => entry.objectId === "2")?.target).toEqual({ v1: 50 });
  });

  it("保持的位置超出行程时也被截断到行程内（和 GO 的范围限制一致）", () => {
    const participants = buildDimensionParticipants(
      [snapshot(2, [HEIGHT, PITCH], { h: 80, p: 2 })],
      [object(2, { h: [0, 500], p: [5, 30] })],
    );
    const { entries } = buildDimensionEntries(participants, { mode: "abs", axis: "v1", value: 10 });
    expect(entries[0]?.target).toEqual({ v1: 10, v2: 5 });
  });

  it("v1 单位不一致的物体一起写，各自按行程截断", () => {
    const participants = buildDimensionParticipants(
      [snapshot(1, [HEIGHT]), snapshot(2, [ANGLE])],
      [object(1, { h: [0, 1000] }), object(2, { h: [0, 360] })],
    );
    const { entries } = buildDimensionEntries(participants, { mode: "abs", axis: "v1", value: 500 });
    expect(entries.map((entry) => entry.target.v1)).toEqual([500, 360]);
  });
});

describe("buildDimensionEntries 相对模式", () => {
  it("目标 = 当前位置 + 增量，各物体按自己的行程截断", () => {
    const participants = liftAndSwing({ lift: { h: 900 }, swing: { h: 400, p: 0, y: 0 } });
    const { entries } = buildDimensionEntries(participants, { mode: "rel", axis: "v1", value: 200 });
    expect(entries.map((entry) => [entry.objectId, entry.target.v1])).toEqual([
      ["1", 1000],
      ["2", 500],
    ]);
  });

  it("已设目标时仍以当前实际位置为基准", () => {
    const participants = liftAndSwing({ lift: { h: 100 }, swing: { h: 100, p: 0, y: 0 } });
    const { entries } = buildDimensionEntries(
      participants,
      { mode: "rel", axis: "v1", value: 20 },
      { "1": { v1: 300 } },
    );
    expect(entries.find((entry) => entry.objectId === "1")?.target.v1).toBe(120);
    expect(entries.find((entry) => entry.objectId === "2")?.target.v1).toBe(120);
  });

  it("第一次进入 GO 准备时其余虚轴保持当前位置", () => {
    const participants = liftAndSwing({ swing: { h: 100, p: 5, y: -3 } });
    const { entries } = buildDimensionEntries(participants, { mode: "rel", axis: "v1", value: 10 });
    expect(entries.find((entry) => entry.objectId === "2")?.target).toEqual({
      v1: 110,
      v2: 5,
      v3: -3,
    });
  });

  it("增量为 0 不写入", () => {
    const participants = liftAndSwing({ lift: { h: 100 }, swing: { h: 100, p: 0, y: 0 } });
    const result = buildDimensionEntries(participants, { mode: "rel", axis: "v1", value: 0 });
    expect(result).toEqual({ entries: [], missingPosition: false });
  });

  it("没有监控位置的物体被跳过并标记，已设目标也不能代替", () => {
    const participants = liftAndSwing({ lift: null, swing: { h: 100, p: 0, y: 0 } });
    const result = buildDimensionEntries(
      participants,
      { mode: "rel", axis: "v1", value: 10 },
      { "1": { v1: 300 } },
    );
    expect(result.entries.map((entry) => entry.objectId)).toEqual(["2"]);
    expect(result.missingPosition).toBe(true);
  });
});
