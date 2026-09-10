import { describe, expect, it } from "vitest";
import { formatHpyLine, formatMonitorNullableNumber } from "./monitor-format";

describe("formatHpyLine", () => {
  it("returns dashes when positions is null", () => {
    expect(formatHpyLine(null, "mm")).toBe("— / — / —");
  });

  it("includes three formatted numbers when positions has values", () => {
    const line = formatHpyLine({ h: 10, p: 20, y: 30 }, "mm");
    expect(line).toContain("10");
    expect(line).toContain("20");
    expect(line).toContain("30");
  });
});

describe("formatMonitorNullableNumber", () => {
  it('returns "—" for null', () => {
    expect(formatMonitorNullableNumber(null)).toBe("—");
  });

  it('returns "0" for zero', () => {
    expect(formatMonitorNullableNumber(0)).toBe("0");
  });
});
