import { describe, expect, it } from "vitest";
import {
  distanceToSegment,
  formatMeasureLength,
  hitTestRulers,
  nearestScreenCandidate,
  rulerDeltaMm,
  rulerLengthMm,
  type ProjectedRuler,
} from "./measure-rulers";

const ruler = { a: { x: 0, y: 1, z: 0 }, b: { x: 3, y: -3, z: 0 } };

describe("ruler values", () => {
  it("measures length and absolute X / Y / Z components in mm", () => {
    expect(rulerLengthMm(ruler)).toBeCloseTo(5000);
    expect(rulerDeltaMm(ruler)).toEqual({ x: 3000, y: 4000, z: 0 });
  });

  it("formats to 0.1 mm in the display unit without trimming zeros", () => {
    expect(formatMeasureLength(1250, "mm")).toBe("1250.0 mm");
    expect(formatMeasureLength(1250, "m")).toBe("1.2500 m");
    expect(formatMeasureLength(0, "cm")).toBe("0.00 cm");
  });
});

describe("hitTestRulers", () => {
  const rulers: ProjectedRuler[] = [
    { id: "r1", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, aInFront: true, bInFront: true },
    { id: "r2", a: { x: 100, y: 4 }, b: { x: 100, y: 100 }, aInFront: true, bInFront: true },
  ];
  const radii = { endpoint: 10, segment: 6 };

  it("prefers the nearest endpoint over a line", () => {
    expect(hitTestRulers({ x: 99, y: 3 }, rulers, radii, null)).toEqual({ kind: "endpoint", id: "r2", endpoint: "a" });
    expect(hitTestRulers({ x: 50, y: 4 }, rulers, radii, null)).toEqual({ kind: "segment", id: "r1" });
    expect(hitTestRulers({ x: 50, y: 50 }, rulers, radii, null)).toBeNull();
  });

  it("does not offer an endpoint that was clipped behind the camera", () => {
    const clipped = [{ ...rulers[0]!, bInFront: false }];
    expect(hitTestRulers({ x: 99, y: 0 }, clipped, radii, null)).toEqual({ kind: "segment", id: "r1" });
  });

  it("lets the selected ruler win a tie", () => {
    const overlapping: ProjectedRuler[] = [
      { id: "r1", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, aInFront: true, bInFront: true },
      { id: "r2", a: { x: 0, y: 0 }, b: { x: 0, y: 100 }, aInFront: true, bInFront: true },
    ];
    expect(hitTestRulers({ x: 1, y: 1 }, overlapping, radii, "r2")).toMatchObject({ id: "r2" });
  });
});

describe("screen helpers", () => {
  it("measures the distance to a segment, clamped to its ends", () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });

  it("picks the nearest candidate inside the radius", () => {
    const candidates = [
      { name: "far", screen: { x: 30, y: 0 } },
      { name: "near", screen: { x: 8, y: 0 } },
    ];
    expect(nearestScreenCandidate({ x: 0, y: 0 }, candidates, 14)?.name).toBe("near");
    expect(nearestScreenCandidate({ x: 0, y: 0 }, candidates, 5)).toBeNull();
  });
});
