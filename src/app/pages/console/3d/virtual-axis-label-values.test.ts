import { describe, expect, it } from "vitest";
import { resolveVirtualAxisLabelValues } from "./virtual-axis-label-values";

describe("resolveVirtualAxisLabelValues", () => {
  it("maps current positions to v1/v2/v3", () => {
    expect(
      resolveVirtualAxisLabelValues({ mode: "current", positions: { h: 100, p: 2, y: 3 } }),
    ).toEqual({ v1: 100, v2: 2, v3: 3 });
  });

  it("returns empty when current positions are null", () => {
    expect(resolveVirtualAxisLabelValues({ mode: "current", positions: null })).toEqual({});
  });

  it("returns target values when mode is target", () => {
    expect(
      resolveVirtualAxisLabelValues({ mode: "target", positions: null, targetValues: { v1: 5 } }),
    ).toEqual({ v1: 5 });
  });

  it("returns empty for target mode without targetValues", () => {
    expect(
      resolveVirtualAxisLabelValues({ mode: "target", positions: { h: 1, p: 1, y: 1 } }),
    ).toEqual({});
  });
});
