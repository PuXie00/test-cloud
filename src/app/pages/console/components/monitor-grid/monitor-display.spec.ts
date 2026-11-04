import { describe, expect, it } from "vitest";
import { formatMonitorDimension } from "./monitor-display";

describe("监控里的虚轴值一律保留一位小数", () => {
  it("长度整数也带一位小数", () => {
    expect(formatMonitorDimension(1500, "mm", "mm")).toBe("1500.0 mm");
    expect(formatMonitorDimension(0, "mm", "mm")).toBe("0.0 mm");
    expect(formatMonitorDimension(12.34, "mm", "mm")).toBe("12.3 mm");
  });

  it("角度整数也带一位小数", () => {
    expect(formatMonitorDimension(5, "°", "mm")).toBe("5.0 °");
    expect(formatMonitorDimension(10.04, "°", "mm")).toBe("10.0 °");
  });

  it("四舍五入到 0 的负数不显示 -0.0", () => {
    expect(formatMonitorDimension(-0.04, "mm", "mm")).toBe("0.0 mm");
    expect(formatMonitorDimension(-0.04, "°", "mm")).toBe("0.0 °");
    expect(formatMonitorDimension(-1.25, "°", "mm")).toBe("-1.3 °");
  });

  it("换成其他长度单位时按原精度换算，同样不去零", () => {
    expect(formatMonitorDimension(1234, "mm", "m")).toBe("1.2340 m");
    expect(formatMonitorDimension(1500, "mm", "cm")).toBe("150.00 cm");
  });

  it("角度不受长度显示单位影响", () => {
    expect(formatMonitorDimension(90, "°", "m")).toBe("90.0 °");
  });

  it("非有限值显示横线", () => {
    expect(formatMonitorDimension(Number.NaN, "mm", "mm")).toBe("—");
  });
});
