import { describe, expect, it } from "vitest";
import { computeNiceTimeTicks } from "./timeline-ticks";

describe("computeNiceTimeTicks visible range", () => {
  it("does not emit the t=0 major tick for window [8000, 12000]", () => {
    const { ticks } = computeNiceTimeTicks(100, 12_000, 8000);
    expect(ticks.some((tick) => tick.ms === 0)).toBe(false);
    expect(ticks.some((tick) => tick.kind === "major" && tick.ms >= 8000 && tick.ms <= 12_000)).toBe(
      true,
    );
  });

  it("still emits t=0 when the window starts at 0", () => {
    const { ticks } = computeNiceTimeTicks(100, 4000);
    expect(ticks.some((tick) => tick.ms === 0 && tick.kind === "major")).toBe(true);
  });

  it("pads major ticks one step past endMs", () => {
    const { majorStepSec, ticks } = computeNiceTimeTicks(16, 60_000);
    expect(majorStepSec).toBe(5);
    const majors = ticks.filter((t) => t.kind === "major");
    expect(majors.map((t) => t.label)).toEqual([
      "0",
      "5",
      "10",
      "15",
      "20",
      "25",
      "30",
      "35",
      "40",
      "45",
      "50",
      "55",
      "1:00",
      "1:05",
    ]);
  });
});