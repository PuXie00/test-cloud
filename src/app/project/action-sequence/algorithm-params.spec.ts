import { describe, expect, it } from "vitest";
import { fsum, nextAfter, ulp } from "./algorithm-params";

/** 期望值取自 Python 的 math.fsum / math.nextafter / math.ulp */
describe("Python float helpers", () => {
  it("fsum rounds the exact sum like math.fsum", () => {
    expect(fsum([1e-16, 1, 1e16])).toBe(1.0000000000000002e16);
    expect(fsum(Array.from({ length: 10 }, () => 0.1))).toBe(1);
    expect(fsum([1e100, 1, -1e100, 1e-100, 1e50, -1, -1e50])).toBe(1e-100);
    expect(fsum([Number.POSITIVE_INFINITY, 1])).toBe(Number.POSITIVE_INFINITY);
    expect(fsum([])).toBe(0);
  });

  it("fsum throws where math.fsum raises", () => {
    expect(() => fsum([1e308, 1e308])).toThrow("intermediate overflow in fsum");
    expect(() => fsum([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])).toThrow("-inf + inf in fsum");
  });

  it("nextAfter and ulp step one float like math.nextafter / math.ulp", () => {
    expect(nextAfter(1, 2)).toBe(1.0000000000000002);
    expect(nextAfter(1, 0)).toBe(0.9999999999999999);
    expect(nextAfter(-1, 0)).toBe(-0.9999999999999999);
    expect(nextAfter(0, -1)).toBe(-5e-324);
    expect(nextAfter(Number.POSITIVE_INFINITY, 0)).toBe(Number.MAX_VALUE);
    expect(ulp(1)).toBe(2.220446049250313e-16);
    expect(ulp(0)).toBe(5e-324);
    expect(ulp(-2)).toBe(4.440892098500626e-16);
    expect(ulp(Number.MAX_VALUE)).toBe(1.99584030953472e292);
  });
});
