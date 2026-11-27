// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlledObjectSnapshot, MotorMonitorSnapshot } from "./monitor-data";

const { selectMock, toggleMultiMock, replaceSelectionMock, mockSnapshots, mockMotorSnapshots } =
  vi.hoisted(() => {
    const snapshots: ControlledObjectSnapshot[] = [
      {
        descriptor: {
          id: 1,
          name: "测试物体",
          type: "mover",
          status: "running",
          dimensions: [],
        },
        values: { height: 10, pitch: 20, yaw: 30 },
        targets: { height: 10, pitch: 20, yaw: 30 },
        speed: 0,
        torquePercent: 0,
        temperatureC: 35,
        history: [],
        live: true,
        positions: { h: 10, p: 20, y: 30 },
        modelStatus: 17,
      },
    ];
    const motorSnapshots: MotorMonitorSnapshot[] = [
      {
        id: 7,
        displayName: "电机-A",
        productModel: "YZ_AXIS_HOIST_500KG",
        live: true,
        status: "running",
        axisStatus: 3,
        actualPosition: 1.5,
        actualSpeed: 100,
        actualLoadRate: 50,
        actualTemperature: 40,
        actualTorque: 2,
        actualWeight: 10,
        driveAlarmCode: 0,
        extras: {},
      },
    ];
    return {
      selectMock: vi.fn(),
      toggleMultiMock: vi.fn(),
      replaceSelectionMock: vi.fn(),
      mockSnapshots: snapshots,
      mockMotorSnapshots: motorSnapshots,
    };
  });
const selectedIds = vi.hoisted(() => [] as number[]);

vi.mock("../../hooks/use-controlled-objects", () => ({
  useControlledObjects: () => ({
    snapshots: mockSnapshots,
    motorSnapshots: mockMotorSnapshots,
    getById: vi.fn(),
  }),
}));

vi.mock("../../hooks/use-project-store", () => ({
  useProjectStore: () => ({
    objects: mockSnapshots.map(({ descriptor }) => ({ id: descriptor.id })),
    motors: [{ id: 7 }],
  }),
}));

vi.mock("@/app/project/use-project-document", () => ({
  useProjectDocument: () => ({
    setup: { controlledObjects: [{}] },
  }),
}));

vi.mock("../../hooks/use-selection", () => ({
  useSelection: () => ({
    multiSelectedIds: selectedIds,
    select: selectMock,
    toggleMulti: toggleMultiMock,
    replaceSelection: replaceSelectionMock,
  }),
}));

vi.mock("@/app/project/display-length-unit-provider", () => ({
  useSessionDisplayLengthUnit: () => "mm" as const,
}));

import { MonitorGrid } from "./monitor-grid";

describe("MonitorGrid", () => {
  afterEach(() => {
    cleanup();
    selectMock.mockClear();
    toggleMultiMock.mockClear();
    replaceSelectionMock.mockClear();
    mockSnapshots.splice(1);
    selectedIds.length = 0;
  });

  it("defaults to object card view with object name and layout toggle", () => {
    render(createElement(MonitorGrid));
    expect(screen.getByText("测试物体")).toBeTruthy();
    expect((screen.getByLabelText("物体布局") as HTMLSelectElement).value).toBe("card");
    expect(screen.queryByText("负载率")).toBeNull();
  });

  it("switches to object table with H/P/Y columns and selects on row click", () => {
    render(createElement(MonitorGrid));
    fireEvent.change(screen.getByLabelText("物体布局"), { target: { value: "table" } });
    expect(screen.getByText("H")).toBeTruthy();
    expect(screen.getByText("P")).toBeTruthy();
    expect(screen.getByText("Y")).toBeTruthy();
    fireEvent.click(screen.getByText("测试物体"));
    expect(selectMock).toHaveBeenCalledWith(1);
  });

  it("switches to motor table without card toggle and does not select on row click", () => {
    render(createElement(MonitorGrid));
    fireEvent.click(screen.getByRole("button", { name: "电机" }));
    expect(screen.getByText("负载率")).toBeTruthy();
    expect(screen.getByText("报警码")).toBeTruthy();
    expect(screen.queryByLabelText("物体布局")).toBeNull();
    fireEvent.click(screen.getByText("7"));
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("sorts table names naturally, follows displayed rows for Shift and preserves the order across views", () => {
    const base = mockSnapshots[0]!;
    for (const [id, name] of [[2, "灯架10"], [3, "灯架2"], [4, "灯架1"]] as const) {
      mockSnapshots.push({ ...base, descriptor: { ...base.descriptor, id, name } });
    }
    selectedIds.push(4);
    render(<MonitorGrid />);
    const switchLayout = (value: string) => fireEvent.change(screen.getByLabelText("物体布局"), { target: { value } });
    const tableNames = () => screen.getAllByRole("row").slice(1)
      .map(row => within(row).getAllByRole("cell")[0]!.textContent).filter(name => name?.startsWith("灯架"));

    switchLayout("table");
    fireEvent.click(within(screen.getByRole("columnheader", { name: /名称/ })).getByRole("button"));
    expect(tableNames()).toEqual(["灯架1", "灯架2", "灯架10"]);
    fireEvent.click(screen.getByText("灯架10"), { shiftKey: true });
    expect(replaceSelectionMock).toHaveBeenLastCalledWith([4, 3, 2]);

    switchLayout("card");
    expect(screen.getAllByText(/^灯架\d+$/).map(el => el.textContent)).toEqual(["灯架10", "灯架2", "灯架1"]);
    fireEvent.click(screen.getByText("灯架10"), { shiftKey: true });
    expect(replaceSelectionMock).toHaveBeenLastCalledWith([2, 3, 4]);
    switchLayout("table");
    fireEvent.click(screen.getByRole("button", { name: "电机" }));
    fireEvent.click(screen.getByRole("button", { name: "物体" }));
    expect(tableNames()).toEqual(["灯架1", "灯架2", "灯架10"]);
  });
});
