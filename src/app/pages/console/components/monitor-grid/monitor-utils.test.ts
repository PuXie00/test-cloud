import { describe, expect, it } from "vitest";
import { isMonitorMotorsEmpty } from "./monitor-utils";

describe("isMonitorMotorsEmpty", () => {
  it("returns true when motor count is 0", () => {
    expect(isMonitorMotorsEmpty(0)).toBe(true);
  });

  it("returns false when motor count is 2", () => {
    expect(isMonitorMotorsEmpty(2)).toBe(false);
  });
});
