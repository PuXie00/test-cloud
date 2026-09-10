import { describe, expect, it } from "vitest";
import type { DimensionDescriptor } from "../../monitor-grid/monitor-data";
import { sharedDimensions } from "./shared-dimensions";

const mm: DimensionDescriptor = { key: "height", label: "升降", unit: "mm" };
const deg: DimensionDescriptor = { key: "angle", label: "旋转", unit: "°" };
const pitch: DimensionDescriptor = { key: "pitch", label: "摆动 X", unit: "°" };

describe("sharedDimensions", () => {
  it("保持单选中维度不变", () => {
    expect(sharedDimensions([[mm, pitch]])).toEqual([mm, pitch]);
  });

  it("v1 混合（mm/°）时保留行并标记 mixed，单位兜底 mm", () => {
    const result = sharedDimensions([[mm], [deg]]);
    expect(result).toEqual([{ key: "height", label: "升降", unit: "mm", mixed: true }]);
  });

  it("v1 混合且旋转物体在前时同样强制 key/label 为 height/升降", () => {
    expect(sharedDimensions([[deg], [mm]])).toEqual([
      { key: "height", label: "升降", unit: "mm", mixed: true },
    ]);
  });

  it("v2 单位一致时正常共享", () => {
    expect(sharedDimensions([[mm, pitch], [mm, pitch]])).toEqual([mm, pitch]);
  });

  it("某轴在部分物体缺失时被剔除", () => {
    expect(sharedDimensions([[mm, pitch], [mm]])).toEqual([mm]);
  });
});
