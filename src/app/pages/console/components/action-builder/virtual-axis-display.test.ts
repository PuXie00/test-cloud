import { describe, expect, it } from "vitest";
import { formatVirtualAxesCompact, formatVirtualAxisCompact } from "./virtual-axis-display";

describe("formatVirtualAxisCompact", () => {
  it("formats move axis (v1) as value+mm without space", () => {
    expect(formatVirtualAxisCompact("v1", 1234, "mm", undefined, "fourPointSwing")).toBe("1234.0mm");
  });

  it("converts to display unit m", () => {
    expect(formatVirtualAxisCompact("v1", 1234, "m", undefined, "fourPointSwing")).toBe("1.2340m");
  });

  it("formats angle axis (v2) as degrees", () => {
    expect(formatVirtualAxisCompact("v2", 5, "mm", undefined, "fourPointSwing")).toBe("5.0°");
  });

  it("rounds swing axes v2 and v3 to one decimal", () => {
    expect(formatVirtualAxisCompact("v2", 1.25, "mm", undefined, "fourPointSwing")).toBe("1.3°");
    expect(formatVirtualAxisCompact("v3", 1.24, "mm", undefined, "fourPointSwing")).toBe("1.2°");
    expect(formatVirtualAxisCompact("v2", 10.04, "mm", undefined, "fourPointSwing")).toBe("10.0°");
    expect(formatVirtualAxisCompact("v3", -3.26, "mm", undefined, "multiPointSwing")).toBe("-3.3°");
    expect(
      formatVirtualAxesCompact(
        ["v1", "v2", "v3"],
        { v1: 1234, v2: 1.25, v3: 2.04 },
        "mm",
        undefined,
        "fourPointSwing",
      ),
    ).toBe("1234.0mm/1.3°/2.0°");
  });
});

describe("formatVirtualAxesCompact", () => {
  it("joins all axes with /", () => {
    expect(
      formatVirtualAxesCompact(
        ["v1", "v2", "v3"],
        { v1: 1234, v2: 5, v3: -3 },
        "mm",
        undefined,
        "fourPointSwing",
      ),
    ).toBe("1234.0mm/5.0°/-3.0°");
  });

  it("filters undefined values", () => {
    expect(
      formatVirtualAxesCompact(["v1", "v2", "v3"], { v1: 1234 }, "mm", undefined, "fourPointSwing"),
    ).toBe("1234.0mm");
  });

  it("returns empty string when no axis has a value", () => {
    expect(formatVirtualAxesCompact(["v1", "v2"], {}, "mm", undefined, "fourPointSwing")).toBe("");
  });

  it("forces one decimal on every virtual axis, including zero and v1 angles", () => {
    expect(formatVirtualAxisCompact("v1", 0, "mm", undefined, "fourPointSwing")).toBe("0.0mm");
    expect(formatVirtualAxisCompact("v2", 0, "mm", undefined, "fourPointSwing")).toBe("0.0°");
    expect(formatVirtualAxisCompact("v1", 12.345, "mm", undefined, "singlePointRotation")).toBe("12.3°");
  });

  it("does not show negative zero", () => {
    expect(formatVirtualAxisCompact("v3", -0.04, "mm", undefined, "fourPointSwing")).toBe("0.0°");
    expect(formatVirtualAxisCompact("v1", -0.04, "mm", undefined, "fourPointSwing")).toBe("0.0mm");
  });
});
