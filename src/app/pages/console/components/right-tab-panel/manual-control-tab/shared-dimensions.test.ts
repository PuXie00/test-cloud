import { describe, expect, it } from "vitest";
import type { DimensionDescriptor } from "../../monitor-grid/monitor-data";
import { dimensionAxis, unionDimensions } from "./shared-dimensions";

const mm: DimensionDescriptor = { key: "height", label: "升降", unit: "mm" };
const deg: DimensionDescriptor = { key: "angle", label: "旋转", unit: "°" };
const pitch: DimensionDescriptor = { key: "pitch", label: "摆动 X", unit: "°" };
const yaw: DimensionDescriptor = { key: "yaw", label: "摆动 Y", unit: "°" };

describe("dimensionAxis", () => {
  it("按维度键映射到虚轴", () => {
    expect(dimensionAxis(mm)).toBe("v1");
    expect(dimensionAxis(deg)).toBe("v1");
    expect(dimensionAxis(pitch)).toBe("v2");
    expect(dimensionAxis(yaw)).toBe("v3");
    expect(dimensionAxis({ key: "unknown" })).toBeUndefined();
  });
});

describe("unionDimensions", () => {
  it("保持单选中维度不变", () => {
    expect(unionDimensions([[mm, pitch]])).toEqual([mm, pitch]);
  });

  it("没有物体时为空", () => {
    expect(unionDimensions([])).toEqual([]);
  });

  it("取并集：某根虚轴只有部分物体有也保留", () => {
    expect(unionDimensions([[mm], [mm, pitch, yaw]])).toEqual([mm, pitch, yaw]);
    expect(unionDimensions([[mm, pitch], [mm]])).toEqual([mm, pitch]);
  });

  it("没有虚轴的物体（空列表）不影响其他物体", () => {
    expect(unionDimensions([[], [mm, pitch]])).toEqual([mm, pitch]);
    expect(unionDimensions([[]])).toEqual([]);
  });

  it("按虚轴 id 合并并排序，不按物体顺序或位置", () => {
    expect(unionDimensions([[pitch], [mm]])).toEqual([mm, pitch]);
  });

  it("v1 混合（mm/°）时保留一行并标记 mixed，单位兜底 mm", () => {
    expect(unionDimensions([[mm], [deg]])).toEqual([
      { key: "height", label: "升降", unit: "mm", mixed: true },
    ]);
  });

  it("v1 混合且旋转物体在前时同样强制 key/label 为 height/升降", () => {
    expect(unionDimensions([[deg], [mm]])).toEqual([
      { key: "height", label: "升降", unit: "mm", mixed: true },
    ]);
  });

  it("v1 混合不影响其他虚轴", () => {
    expect(unionDimensions([[mm, pitch], [deg]])).toEqual([
      { key: "height", label: "升降", unit: "mm", mixed: true },
      pitch,
    ]);
  });

  it("v2 单位一致时正常共享", () => {
    expect(unionDimensions([[mm, pitch], [mm, pitch]])).toEqual([mm, pitch]);
  });

  it("同一根虚轴标签不同（摆动 Y / 偏转）但单位一致时取第一个物体的", () => {
    const yawY: DimensionDescriptor = { key: "yaw", label: "偏转", unit: "°" };
    expect(unionDimensions([[mm, pitch, yawY], [mm, pitch, yaw]])).toEqual([mm, pitch, yawY]);
  });
});
