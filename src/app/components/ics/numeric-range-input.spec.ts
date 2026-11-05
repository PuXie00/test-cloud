import { describe, expect, it } from "vitest";
import { rangeInputBounds } from "./numeric-range-input";

describe("rangeInputBounds", () => {
  it("keeps min below max and max above min as before", () => {
    expect(rangeInputBounds({ value: { min: 10, max: 50 }, min: 0, max: 100 })).toEqual({
      minInputMax: 50,
      maxInputMin: 10,
    });
  });

  it("adds a ceiling for the lower end and a floor for the upper end", () => {
    // 多级升降：下限 ∈ [-200000, 0]，上限 ∈ [0, 200000]
    expect(
      rangeInputBounds({
        value: { min: -100, max: 500 },
        min: -200000,
        minCeiling: 0,
        maxFloor: 0,
        max: 200000,
      }),
    ).toEqual({ minInputMax: 0, maxInputMin: 0 });
    expect(
      rangeInputBounds({ value: { min: -500, max: -200 }, minCeiling: 0, maxFloor: 0 }),
    ).toEqual({ minInputMax: -200, maxInputMin: 0 });
  });
});
