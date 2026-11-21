import { describe, expect, it } from "vitest";
import { roundRopeLengths, type Vec3 } from "./multi-point-forward";
import { solveXyMultiPointForward } from "./xy-multi-point-forward";

const SQUARE: Vec3[] = [
  [100, 100, 0],
  [-100, 100, 0],
  [-100, -100, 0],
  [100, -100, 0],
];

const lengthsOf = (
  height: number,
  angleX: number,
  angleY: number,
  extras: Partial<{
    pointInitPos: Vec3[];
    baseHeight1: number;
    baseHeight2: number;
  }> = {},
) =>
  roundRopeLengths(
    solveXyMultiPointForward({
      height,
      angleX,
      angleY,
      pointInitPos: extras.pointInitPos ?? SQUARE,
      baseHeight1: extras.baseHeight1 ?? 80,
      baseHeight2: extras.baseHeight2 ?? 0,
      maxHeight: 800,
    }),
  );

describe("solveXyMultiPointForward", () => {
  it("matches xy_duodian_forward_model at rest and lift-only", () => {
    expect(lengthsOf(0, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(lengthsOf(200, 0, 0)).toEqual([200, 200, 200, 200]);
  });

  it("tilts about X and about Y independently", () => {
    expect(lengthsOf(200, 10, 0)).toEqual([217.37, 217.37, 182.64, 182.64]);
    expect(lengthsOf(200, 0, 10)).toEqual([182.64, 217.37, 217.37, 182.64]);
  });

  it("matches combined X and Y tilt", () => {
    expect(lengthsOf(300, 12, -8)).toEqual([334.53, 306.68, 265.52, 293.34]);
  });

  it("matches the bottom-hung branch", () => {
    expect(lengthsOf(200, 10, 5, { baseHeight1: 0, baseHeight2: 120 })).toEqual([
      191.41, 173.98, 208.58, 226.01,
    ]);
  });

  it("builds the convex hull regardless of mount order and inner points", () => {
    const unordered: Vec3[] = [
      [100, 100, 0],
      [-100, -100, 0],
      [-100, 100, 0],
      [100, -100, 0],
      [0, 50, 0],
    ];
    expect(lengthsOf(300, -9, 6, { pointInitPos: unordered })).toEqual([
      274, 326.02, 294.9, 305.11, 292.22,
    ]);
  });

  it("skips the planar offset for two hoist points", () => {
    const twoPoint: Vec3[] = [
      [-150, 0, 0],
      [150, 0, 0],
    ];
    expect(lengthsOf(250, 0, 12, { pointInitPos: twoPoint })).toEqual([281.2, 218.83]);
  });
});
