import { describe, expect, it } from "vitest";
import { hoistAxesEqual } from "./hoist-axis-config";
import type { HoistAxisConfig } from "./types";

const axis = (overrides: Partial<HoistAxisConfig> = {}): HoistAxisConfig => ({
  key: "0",
  motorId: "1",
  mount: { x: 0, z: 0 },
  index: 0,
  motorDisplayIndex: 0,
  ...overrides,
});

describe("hoistAxesEqual", () => {
  it("treats matching axes as equal", () => {
    expect(hoistAxesEqual([axis()], [axis()])).toBe(true);
  });

  it("detects motorDisplayIndex-only changes", () => {
    expect(hoistAxesEqual([axis()], [axis({ motorDisplayIndex: 1 })])).toBe(false);
    expect(hoistAxesEqual([axis()], [axis({ motorDisplayIndex: null })])).toBe(false);
  });
});
