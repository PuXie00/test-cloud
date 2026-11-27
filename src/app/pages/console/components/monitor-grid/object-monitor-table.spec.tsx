// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlledObjectSnapshot } from "./monitor-data";
import { ObjectMonitorTable, sortMonitorObjects } from "./object-monitor-table";

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
        sort={null}
        onSort={vi.fn()}
      />,
    );

    const rowOf = (name: string) => screen.getByText(name).closest("tr")!.textContent;
    expect(rowOf("转台")).toContain("90.0 °");
    expect(rowOf("转台")).not.toContain(" m");
    expect(rowOf("灯架")).toContain("1.5000 m");
    expect(rowOf("灯架")).toContain("5.0 °");
  });

  it("按状态优先级排序", () => {
    const states = ["offline", "running", "disabled", "warning", "alarm", "ready"] as const;
    const rows = states.map((status, index) => {
      const row = snapshot(index, status, [], null);
      row.descriptor.status = status;
      return row;
    });
    const sorted = sortMonitorObjects(rows, { key: "status", direction: "ascending" });
    expect(sorted.map(row => row.descriptor.status)).toEqual(["alarm", "warning", "running", "ready", "disabled", "offline"]);
    // 两个不同状态码都显示「未耦合」；排序时聚到同组，保留原相对顺序。
    const ready = [2, 16, 1].map(modelStatus => ({
      ...snapshot(modelStatus, String(modelStatus), [], null), modelStatus,
    }));
    expect(sortMonitorObjects(ready, { key: "status", direction: "ascending" }).map(row => row.modelStatus))
      .toEqual([16, 2, 1]);
  });

  it("H 按单位分组并比较原始数值，P 和 Y 直接按角度排序；空值均置后", () => {
    const dims = (unit: string) => [{ key: "h", label: "H", unit }];
    const rows = [
      snapshot(1, "转台甲", dims("°"), { h: 16, p: 80, y: -8 }),
      snapshot(2, "灯架甲", dims("mm"), { h: 15.02, p: 9 }),
      snapshot(3, "转台乙", dims("°"), { h: -15, y: 10 }),
      snapshot(4, "灯架乙", dims("mm"), { h: 15.01, p: -1, y: 2 }),
      snapshot(5, "无反馈", dims("°"), null),
    ];
    const sort = (key: string, direction: "ascending" | "descending") => sortMonitorObjects(rows, { key, direction });
    const ids = (data: typeof rows) => data.map(row => row.descriptor.id);
    for (const direction of ["ascending", "descending"] as const) {
      const sorted = sort("h", direction);
      expect(sorted.at(-1)?.descriptor.id).toBe(5);
      const groups = sorted.slice(0, -1).map(row => row.descriptor.dimensions[0]!.unit);
      expect(groups[0]).toBe(groups[1]);
      expect(groups[2]).toBe(groups[3]);
      expect(groups[0]).not.toBe(groups[3]);
      expect(ids(sorted.filter(row => row.descriptor.dimensions[0]!.unit === "mm")))
        .toEqual(direction === "ascending" ? [4, 2] : [2, 4]);
    }
    expect(ids(sort("p", "ascending"))).toEqual([4, 2, 1, 3, 5]);
    expect(ids(sort("y", "descending"))).toEqual([3, 4, 1, 2, 5]);
  });
});
