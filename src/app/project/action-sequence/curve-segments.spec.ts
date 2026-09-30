import { describe, expect, it } from "vitest";
import { trapezoidToCurveSegments } from "./curve-segments";
import type { MotionProfile } from "./types";

const trap = (accelMs: number, decelMs: number): MotionProfile => ({
  kind: "trapezoid",
  params: { accelMs, decelMs },
});

const idle = (): MotionProfile => ({ kind: "idle" });

const zeroTail = { d: 0, e: 0, f: 0 };

describe("trapezoidToCurveSegments", () => {
  it("writes position as A and velocity/accel in 0.1s units", () => {
    const rows = trapezoidToCurveSegments(trap(200, 200), 0, 0, 100, 1000);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ startTime: 0, position: 0, a: 0, b: 0, c: 3.125, ...zeroTail });
    expect(rows[1]).toEqual({ startTime: 200, position: 12.5, a: 12.5, b: 12.5, c: 0, ...zeroTail });
    expect(rows[2]?.startTime).toBe(800);
    expect(rows[2]?.position).toBeCloseTo(87.5, 6);
    expect(rows[2]?.a).toBeCloseTo(87.5, 6);
    expect(rows[2]?.b).toBeCloseTo(12.5, 6);
    expect(rows[2]?.c).toBeCloseTo(-3.125, 6);
  });

  it("signs B and C with travel", () => {
    const rows = trapezoidToCurveSegments(trap(200, 200), 0, 50, 30, 1000);
    expect(rows[0]?.a).toBe(50);
    expect(rows[0]?.c).toBe(-0.625);
    expect(rows[1]?.b).toBe(-2.5);
    expect(rows[2]?.b).toBe(-2.5);
    expect(rows[2]?.c).toBe(0.625);
    expect(rows[0]?.position).toBe(50);
    expect(rows[1]?.position).toBe(47.5);
    expect(rows[2]?.position).toBe(32.5);
  });

  it("omits the zero-length cruise row of a triangle", () => {
    const rows = trapezoidToCurveSegments(trap(200, 200), 1000, 0, 100, 400);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.startTime).toBe(1000);
    expect(rows[1]?.startTime).toBe(1200);
    expect(rows[0]?.c).toBeCloseTo(12.5, 6);
    expect(rows[1]?.b).toBe(50);
    expect(rows[1]?.c).toBeCloseTo(-12.5, 6);
    expect(rows[1]?.position).toBe(50);
    expect(rows[1]?.a).toBe(50);
  });

  it("holds with A equal to position", () => {
    expect(trapezoidToCurveSegments(idle(), 3000, 42, 42, 1000)).toEqual([
      { startTime: 3000, position: 42, a: 42, b: 0, c: 0, ...zeroTail },
    ]);
    expect(trapezoidToCurveSegments(trap(200, 200), 0, 10, 10, 1000)).toEqual([
      { startTime: 0, position: 10, a: 10, b: 0, c: 0, ...zeroTail },
    ]);
  });

  it("keeps full position and coefficient precision", () => {
    const rows = trapezoidToCurveSegments(trap(200, 200), 0, 0.16, 33.16, 1000);
    expect(rows[0]?.position).toBe(0.16);
    expect(rows[0]?.a).toBe(0.16);
    expect(rows[0]?.c).toBeCloseTo(1.03125, 5);
    expect(rows[1]?.position).toBeCloseTo(4.285, 3);
    expect(rows[1]?.a).toBeCloseTo(4.285, 3);
    expect(rows[1]?.b).toBeCloseTo(4.125, 5);
    expect(rows[2]?.position).toBeCloseTo(29.035, 3);
    expect(rows[2]?.c).toBeCloseTo(-1.03125, 5);
  });
});
