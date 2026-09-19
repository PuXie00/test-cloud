// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("../../hooks/use-controlled-objects", () => ({
  useControlledObjects: () => ({
    snapshots: mockSnapshots,
    motorSnapshots: mockMotorSnapshots,
    getById: vi.fn(),
  }),
}));

vi.mock("../../hooks/use-project-store", () => ({
  useProjectStore: () => ({
    objects: [{ id: 1 }],
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
    multiSelectedIds: [],
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
});
