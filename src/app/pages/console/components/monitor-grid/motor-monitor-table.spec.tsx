// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DisplayAttribute } from "@shared/config";
import type { MotorMonitorSnapshot } from "./monitor-data";
import { MotorMonitorTable } from "./motor-monitor-table";

const attrs: DisplayAttribute[] = [
  { id: "actualWeight", label: "称重", display: true, dataType: "float" },
  { id: "encoder", label: "编码值", display: true, dataType: "float" },
  { id: "mode", label: "工作模式", display: true, dataType: "enum", values: [[1, "Zulu"], [7, "Alpha"]] },
];
vi.mock("../../hooks/motor-config", () => ({
  preloadMotorModelConfigs: () => Promise.resolve(),
  getExtendedStateAttrs: (models: string[]) => models.includes("scale") ? attrs : [],
}));

const motor = (id: number, fields: Partial<MotorMonitorSnapshot> = {}): MotorMonitorSnapshot => ({
  id, displayName: String(id), productModel: "scale", live: true, status: "ready", axisStatus: 2,
  actualPosition: null, actualSpeed: null, actualLoadRate: null, actualTemperature: null,
  actualTorque: null, actualWeight: null, driveAlarmCode: null, extras: {}, ...fields,
});
const ids = () => screen.getAllByRole("row").slice(1)
  .map(row => Number(within(row).getAllByRole("cell")[0]!.textContent));

afterEach(cleanup);

describe("motor monitor table sorting", () => {
  it("emits a header request and sorts precise raw numbers with missing values last", async () => {
    const motors = [motor(10, { actualPosition: 1.00002 }), motor(2), motor(8, { actualPosition: 1.00001 }),
      motor(3, { actualPosition: -12 })];
    const onSort = vi.fn();
    const view = render(<MotorMonitorTable motors={motors} sort={null} onSort={onSort} />);
    await screen.findByRole("columnheader", { name: /称重/ });
    expect(ids()).toEqual([10, 2, 8, 3]);
    fireEvent.click(screen.getByRole("button", { name: /位置/ }));
    expect(onSort).toHaveBeenCalledWith("actualPosition");
    view.rerender(<MotorMonitorTable motors={motors} sort={{ key: "actualPosition", direction: "ascending" }} onSort={onSort} />);
    expect(ids()).toEqual([3, 8, 10, 2]);
    view.rerender(<MotorMonitorTable motors={motors} sort={{ key: "actualPosition", direction: "descending" }} onSort={onSort} />);
    expect(ids()).toEqual([10, 8, 3, 2]);
  });

  it("ranks the effective status shown on the badge, including alarms and offline axes", async () => {
    const motors = [motor(10, { axisStatus: 3, live: false }), motor(20, { axisStatus: 2 }),
      motor(30, { axisStatus: 3 }), motor(40, { axisStatus: 3, driveAlarmCode: 99 })];
    render(<MotorMonitorTable motors={motors} sort={{ key: "status", direction: "ascending" }} onSort={() => {}} />);
    await screen.findByRole("columnheader", { name: /称重/ });
    expect(ids()).toEqual([40, 30, 20, 10]);
    expect(within(screen.getAllByRole("row")[1]!).getByText("错误")).toBeDefined();
  });

  it("sorts model values, enum labels and top-level weights, falling back when the selected column disappears", async () => {
    const motors = [motor(7), motor(8, { actualWeight: 16, extras: { encoder: 12, mode: 7 } }),
      motor(9, { actualWeight: 2, extras: { encoder: 2, mode: 1 } })];
    const table = (key: string, rows = motors) =>
      <MotorMonitorTable motors={rows} sort={{ key, direction: "ascending" }} onSort={() => {}} />;
    const view = render(table("extra:actualWeight"));
    await screen.findByRole("columnheader", { name: /称重/ });
    expect(ids()).toEqual([9, 8, 7]);
    expect(within(screen.getAllByRole("row")[2]!).getByText("16")).toBeDefined();
    view.rerender(table("extra:encoder"));
    expect(ids()).toEqual([9, 8, 7]);
    view.rerender(table("extra:mode"));
    expect(ids()).toEqual([8, 9, 7]);
    view.rerender(table("extra:mode", motors.map(m => ({ ...m, productModel: "basic" }))));
    expect(screen.queryByRole("columnheader", { name: /工作模式/ })).toBeNull();
    expect(ids()).toEqual([7, 8, 9]);
  });
});
