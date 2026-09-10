import { describe, expect, it } from "vitest";
import { formatVirtualAxesCompact, formatVirtualAxisCompact } from "./virtual-axis-display";

describe("formatVirtualAxisCompact", () => {
  it("formats move axis (v1) as value+mm without space", () => {
    expect(formatVirtualAxisCompact("v1", 1234, "mm", undefined, "fourPointSwing")).toBe("1234mm");
  });

  it("converts to display unit m", () => {
    expect(formatVirtualAxisCompact("v1", 1234, "m", undefined, "fourPointSwing")).toBe("1.234m");
  });

  it("formats angle axis (v2) as degrees", () => {
    expect(formatVirtualAxisCompact("v2", 5, "mm", undefined, "fourPointSwing")).toBe("5°");
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
    ).toBe("1234mm/5°/-3°");
  });

  it("filters undefined values", () => {
    expect(
      formatVirtualAxesCompact(["v1", "v2", "v3"], { v1: 1234 }, "mm", undefined, "fourPointSwing"),
    ).toBe("1234mm");
  });

  it("returns empty string when no axis has a value", () => {
    expect(formatVirtualAxesCompact(["v1", "v2"], {}, "mm", undefined, "fourPointSwing")).toBe("");
  });
});
