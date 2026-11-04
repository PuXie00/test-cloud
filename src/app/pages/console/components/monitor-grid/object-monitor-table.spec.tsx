// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlledObjectSnapshot } from "./monitor-data";
import { ObjectMonitorTable } from "./object-monitor-table";

vi.mock("@/app/project/display-length-unit-provider", () => ({
  useSessionDisplayLengthUnit: () => "m",
}));

const snapshot = (
  id: number,
  name: string,
  dimensions: ControlledObjectSnapshot["descriptor"]["dimensions"],
  positions: ControlledObjectSnapshot["positions"],
): ControlledObjectSnapshot => ({
  descriptor: { id, name, type: "lift-truss", status: "ready", dimensions },
  values: {},
  targets: {},
  speed: 0,
  torquePercent: 0,
  temperatureC: 0,
  history: [],
  live: true,
  positions,
  modelStatus: null,
});

afterEach(() => cleanup());

describe("物体监控表格", () => {
  it("H 列用物体自己的单位：旋转类显示角度，不被当成长度换算", () => {
    render(
      <ObjectMonitorTable
        snapshots={[
          snapshot(1, "转台", [{ key: "rotation", label: "旋转", unit: "°" }], { h: 90 }),
          snapshot(2, "灯架", [{ key: "height", label: "升降", unit: "mm" }], { h: 1500, p: 5 }),
        ]}
        selectedIds={[]}
        onSelect={vi.fn()}
      />,
    );

    const rowOf = (name: string) => screen.getByText(name).closest("tr")!.textContent;
    expect(rowOf("转台")).toContain("90.0 °");
    expect(rowOf("转台")).not.toContain(" m");
    expect(rowOf("灯架")).toContain("1.5000 m");
    expect(rowOf("灯架")).toContain("5.0 °");
  });
});
