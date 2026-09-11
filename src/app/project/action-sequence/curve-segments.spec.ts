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
  it("emits three signed phase rows for a forward trapezoid", () => {
    const rows = trapezoidToCurveSegments(trap(200, 200), 0, 0, 100, 1000);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ startTime: 0, position: 0, a: 625, b: 0, c: 0, ...zeroTail });
    expect(rows[1]).toEqual({ startTime: 200, position: 12.5, a: 0, b: 125, c: 0, ...zeroTail });
    expect(rows[2]).toEqual({ startTime: 800, position: 87.5, a: 0, b: 0, c: 625, ...zeroTail });
  });

  it("negates a/b/c when travel is negative", () => {
    const rows = trapezoidToCurveSegments(trap(200, 200), 0, 50, 30, 1000);
    expect(rows[0]?.a).toBe(-125);
    expect(rows[1]?.b).toBe(-25);
    expect(rows[2]?.c).toBe(-125);
    expect(rows[0]?.position).toBe(50);
    expect(rows[1]?.position).toBe(47.5);
    expect(rows[2]?.position).toBe(32.5);
  });

  it("keeps three rows for a triangle with b=0 and shared cruise/decel startTime", () => {
    const rows = trapezoidToCurveSegments(trap(200, 200), 1000, 0, 100, 400);
    expect(rows).toHaveLength(3);
    expect(rows[1]?.b).toBe(0);
    expect(rows[1]?.startTime).toBe(1200);
    expect(rows[2]?.startTime).toBe(1200);
    expect(rows[1]?.position).toBe(rows[2]?.position);
    expect(rows[0]?.a).toBe(2500);
    expect(rows[2]?.c).toBe(2500);
  });

  it("emits one zero-coeff hold for idle or zero travel", () => {
    expect(trapezoidToCurveSegments(idle(), 3000, 42, 42, 1000)).toEqual([
      { startTime: 3000, position: 42, a: 0, b: 0, c: 0, ...zeroTail },
    ]);
    expect(trapezoidToCurveSegments(trap(200, 200), 0, 10, 10, 1000)).toEqual([
      { startTime: 0, position: 10, a: 0, b: 0, c: 0, ...zeroTail },
    ]);
  });
});
