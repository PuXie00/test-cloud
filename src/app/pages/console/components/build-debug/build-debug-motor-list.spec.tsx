// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DisplayAttribute } from "@shared/config";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import type { DisplayLengthUnit } from "@/app/project/display-length-units";
import { BuildDebugContext, type BuildDebugContextValue } from "./build-debug-context";
import type { BuildMotorTelemetry } from "./build-debug-types";
import { BuildDebugMotorList } from "./build-debug-motor-list";

const motor = (id: number, controlledObjectId: number | null) => ({
  id,
  productModel: "SV660",
  plcId: 1,
  busNo: 0 as const,
  axisType: 0 as const,
  nodeAddress: null,
  selected: false,
  controlledObjectId,
  axisKey: null,
  params: {},
});

const store = {
  motors: [motor(11, 5), motor(12, 5)],
  objects: [{ id: 5, name: "吊杆一" }],
  plcs: [{ id: 1 }],
  getObjectMotors: (objectId: number) => store.motors.filter((m) => m.controlledObjectId === objectId),
  getPlcUnassignedMotors: () => [],
};

vi.mock("@/app/pages/console/hooks/use-project-store", () => ({
  useProjectStore: () => store,
}));

vi.mock("@/app/pages/console/hooks/motor-mid", () => ({
  formatMotorDisplayName: (_motors: unknown, m: { id: number } | number) =>
    `M${typeof m === "number" ? m : m.id}`,
}));

const attr = (partial: Partial<DisplayAttribute> & Pick<DisplayAttribute, "id" | "label">) =>
  ({ dataType: "uint16", display: true, type: "variable", ...partial }) as DisplayAttribute;

vi.mock("@/app/pages/console/hooks/motor-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/pages/console/hooks/motor-config")>()),
  preloadMotorModelConfigs: () => Promise.resolve(),
  getCachedMotorModelConfig: () => ({
    variableStateAttri: [
      attr({ id: "actualWeight", label: "称重" }),
      // 描述文件把速度也标成 variable 时不再多出一列
      attr({ id: "actualSpeed", label: "实际速度", unit: "mm/s" }),
    ],
  }),
}));

vi.mock("./build-debug-bar", () => ({ BuildDebugBar: () => null }));

const telemetry: Record<number, BuildMotorTelemetry> = {
  11: {
    status: "moving",
    values: {
      actualPosition: 1300,
      actualSpeed: 12.34,
      actualTemperature: 36,
      actualTorque: 40,
      actualWeight: 88,
    },
  },
  12: { status: "powerOff", values: {} },
};

const debugValue = (): BuildDebugContextValue =>
  ({
    armed: true,
    primaryMotorId: null,
    selectedMotorIds: new Set<number>(),
    coupledObjectIds: new Set<number>(),
    arm: vi.fn(),
    disarm: vi.fn(),
    toggleMotor: vi.fn(),
    selectMotors: vi.fn(),
    clearSelection: vi.fn(),
    displayPositionOf: (id: number) => (id === 11 ? 1234.5 : 0),
    telemetryOf: (id: number) => telemetry[id] ?? { status: "powerOff", values: {} },
    imbalancedInObject: () => new Set<number>(),
    isMotorOnline: (id: number) => id === 11,
    isMotorSelectable: (id: number) => id === 11,
    isObjectDecoupled: () => true,
    setObjectDecoupled: vi.fn(),
    setAllObjectsDecoupled: vi.fn(),
  }) as unknown as BuildDebugContextValue;

const renderList = (unit: DisplayLengthUnit = "mm") =>
  render(
    <DisplayLengthUnitProvider initialUnit={unit}>
      <BuildDebugContext.Provider value={debugValue()}>
        <BuildDebugMotorList />
      </BuildDebugContext.Provider>
    </DisplayLengthUnitProvider>,
  );

const readouts = (row: HTMLElement) =>
  [...row.querySelectorAll<HTMLElement>("[data-readout]")].map((el) => el.textContent);

afterEach(() => cleanup());

describe("调试页电机列表 · 短前缀", () => {
  it("在线电机：p: 位置 / s: 速度 / t: 温度 / m: 力矩 / w: 称重", () => {
    renderList();
    const row = screen.getByRole("button", { name: "M11" });
    expect(readouts(row)).toEqual(["p: 1234.5", "s: 12.3", "t: 36°", "m: 40%", "w: 88"]);
    // 全称留在 title 里
    expect(within(row).getByTitle("位置").textContent).toBe("p: 1234.5");
    expect(within(row).getByTitle("速度").textContent).toBe("s: 12.3");
  });

  it("各列左对齐", () => {
    renderList();
    const row = screen.getByRole("button", { name: "M11" });
    for (const cell of row.querySelectorAll<HTMLElement>("[data-readout]")) {
      expect(cell.className).toContain("text-left");
      expect(cell.className).not.toContain("text-right");
    }
    expect(within(row).getByText("运动").closest("span.rounded-full")!.className).toContain(
      "justify-self-start",
    );
  });

  it("位置、速度随会话单位换算，精度不变", () => {
    renderList("m");
    const row = screen.getByRole("button", { name: "M11" });
    expect(readouts(row).slice(0, 2)).toEqual(["p: 1.2345", "s: 0.0123"]);
  });

  it("离线电机不显示数据", () => {
    renderList();
    const row = screen.getByRole("button", { name: "M12 未连接" });
    expect(readouts(row)).toEqual([]);
  });
});
