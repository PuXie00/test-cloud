import { describe, expect, it } from "vitest";
import { faderToSpeedPercent, speedTopPercent } from "./speed-cap";

describe("faderToSpeedPercent", () => {
  it("keeps the lower half 1:1 and stretches the upper half to the speed range", () => {
    expect([0, 50, 100].map((position) => faderToSpeedPercent(position, 150))).toEqual([0, 50, 100]);
    expect([125, 150, 200].map((position) => faderToSpeedPercent(position, 150))).toEqual([113, 125, 150]);
  });

  it("stops at the system ceiling of 200%", () => {
    expect(faderToSpeedPercent(150, 380)).toBe(150);
    expect(faderToSpeedPercent(200, 380)).toBe(200);
    expect(faderToSpeedPercent(200, null)).toBe(200);
    expect(speedTopPercent(380)).toBe(200);
  });

  it("holds at the top when even the programmed speed is too fast", () => {
    expect(faderToSpeedPercent(60, 80)).toBe(60);
    expect(faderToSpeedPercent(100, 80)).toBe(80);
    expect(faderToSpeedPercent(200, 80)).toBe(80);
  });
});
