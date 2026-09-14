import { describe, expect, it } from "vitest";
import {
  TIME_STEP_MS,
  formatTime,
  msToSeconds,
  pxToMs,
  secondsToMs,
  snapTimeMs,
} from "./timeline-data";

describe("snapTimeMs", () => {
  it("snaps to 100ms and clamps negatives to 0", () => {
    expect(TIME_STEP_MS).toBe(100);
    expect(snapTimeMs(0)).toBe(0);
    expect(snapTimeMs(50)).toBe(100);
    expect(snapTimeMs(149)).toBe(100);
    expect(snapTimeMs(150)).toBe(200);
    expect(snapTimeMs(-10)).toBe(0);
  });
});

describe("formatTime", () => {
  it("prints total seconds with one decimal", () => {
    expect(formatTime(0)).toBe("0.0");
    expect(formatTime(1500)).toBe("1.5");
    expect(formatTime(90_500)).toBe("90.5");
    expect(formatTime(1500)).not.toMatch(/:/);
  });
});

describe("seconds conversion", () => {
  it("converts and snaps 0.14s to 100ms", () => {
    expect(msToSeconds(1500)).toBe(1.5);
    expect(secondsToMs(0.14)).toBe(100);
    expect(secondsToMs(0.1)).toBe(100);
  });
});

describe("pxToMs", () => {
  it("still rounds to 1ms so pan is not on the authored grid", () => {
    expect(pxToMs(84.7, 100)).toBe(847);
  });
});
