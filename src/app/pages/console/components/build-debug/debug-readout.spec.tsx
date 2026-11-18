// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEBUG_FIXED_READOUT_IDS,
  DebugReadout,
  POSITION_READOUT,
  SPEED_READOUT,
  TEMPERATURE_READOUT,
  TORQUE_READOUT,
  debugReadoutMeta,
  formatDebugPositionReadout,
  formatDebugSpeedReadout,
} from "./debug-readout";

afterEach(() => cleanup());

describe("调试页数据短前缀", () => {
  it("位置 p、速度 s、温度 t、力矩 m，全称留作 title", () => {
    expect(POSITION_READOUT).toEqual({ prefix: "p", label: "位置" });
    expect(SPEED_READOUT).toEqual({ prefix: "s", label: "速度" });
    expect(TEMPERATURE_READOUT).toEqual({ prefix: "t", label: "温度" });
    expect(TORQUE_READOUT).toEqual({ prefix: "m", label: "力矩" });
  });

  it("描述文件字段：约定过的用字母，没约定的用自己的名称", () => {
    expect(debugReadoutMeta({ id: "actualWeight", label: "称重" }).prefix).toBe("w");
    expect(debugReadoutMeta({ id: "actualLoadRate", label: "负载率" }).prefix).toBe("l");
    expect(debugReadoutMeta({ id: "driveAlarmCode", label: "驱动报警码" }).prefix).toBe("e");
    expect(debugReadoutMeta({ id: "busVoltage", label: "母线电压" })).toEqual({
      prefix: "母线电压",
      label: "母线电压",
    });
  });

  it("前缀各不相同", () => {
    const prefixes = [
      "actualPosition",
      "actualSpeed",
      "actualTemperature",
      "actualTorque",
      "actualWeight",
      "actualLoadRate",
      "driveAlarmCode",
    ].map((id) => debugReadoutMeta({ id, label: id }).prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("固定列是位置 / 速度 / 温度 / 力矩", () => {
    expect([...DEBUG_FIXED_READOUT_IDS]).toEqual([
      "actualPosition",
      "actualSpeed",
      "actualTemperature",
      "actualTorque",
    ]);
  });
});

describe("数值格式不变", () => {
  it("位置：0.1 mm 精度，随会话单位换算", () => {
    expect(formatDebugPositionReadout(1234.56, "mm")).toBe("1234.6");
    expect(formatDebugPositionReadout(1500, "m")).toBe("1.5");
  });

  it("速度：0.1 mm/s 精度，随会话单位换算；没遥测是 —", () => {
    const telemetry = (values: Record<string, number>) => ({ status: "moving" as const, values });
    expect(formatDebugSpeedReadout(telemetry({ actualSpeed: 12.34 }), "mm")).toBe("12.3");
    expect(formatDebugSpeedReadout(telemetry({ actualSpeed: 1500 }), "m")).toBe("1.5");
    expect(formatDebugSpeedReadout(telemetry({}), "mm")).toBe("—");
  });
});

describe("DebugReadout", () => {
  it("渲染成「p: 值」，前缀弱化、数值保留色调，不换行", () => {
    const { container } = render(
      <DebugReadout meta={POSITION_READOUT} value="1234.5" valueClassName="text-warning" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.textContent).toBe("p: 1234.5");
    expect(root.title).toBe("位置");
    expect(root.className).toContain("whitespace-nowrap");
    expect(root.className).toContain("tabular-nums");
    const [prefix, value] = root.querySelectorAll("span");
    expect(prefix!.className).toContain("text-muted-foreground");
    expect(value!.className).toContain("text-warning");
  });
});
