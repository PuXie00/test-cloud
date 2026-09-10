import { describe, expect, it } from "vitest";
import { roundRopeLengths, solveMultiPointForward, type Vec3 } from "./multi-point-forward";

const SQUARE: Vec3[] = [
  [100, 100, 0],
  [-100, 100, 0],
  [-100, -100, 0],
  [100, -100, 0],
];

const lengthsOf = (
  height: number,
  roll: number,
  pitch: number,
  extras: Partial<{
    baseHeight1: number;
    baseHeight2: number;
    maxHeight: number;
    betaInit: number;
  }> = {},
) =>
  roundRopeLengths(
    solveMultiPointForward({
      height,
      roll,
      pitch,
      pointInitPos: SQUARE,
      baseHeight1: extras.baseHeight1 ?? 80,
      baseHeight2: extras.baseHeight2 ?? 0,
      maxHeight: extras.maxHeight ?? 800,
      betaInit: extras.betaInit ?? 0,
    }),
  );

describe("solveMultiPointForward", () => {
  it("matches YXZ rest and lift-only cases", () => {
    expect(lengthsOf(0, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(lengthsOf(200, 0, 0)).toEqual([200, 200, 200, 200]);
  });

  it("superimposes pitch onto hoist lengths", () => {
    expect(lengthsOf(200, 0, 10)).toEqual([217.37, 217.37, 182.64, 182.64]);
  });

  it("keeps equal rope lengths for yaw-only at zero pitch", () => {
    expect(lengthsOf(200, 15, 0)).toEqual([200, 200, 200, 200]);
  });

  it("matches combined H/P/Y with initial tilt", () => {
    expect(lengthsOf(300, 12, -8, { betaInit: 90 })).toEqual([316.51, 289.28, 283.5, 310.72]);
  });

  it("matches the bottom-hung branch", () => {
    expect(lengthsOf(200, 10, 5, { baseHeight1: 0, baseHeight2: 120 })).toEqual([
      192.93, 189.9, 207.07, 210.1,
    ]);
  });
});
