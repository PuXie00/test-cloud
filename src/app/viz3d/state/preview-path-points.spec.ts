import { describe, expect, it } from "vitest";
import type { SceneObjectConfig } from "../types";
import { previewPathPoints } from "./preview-path-points";

const base = {
  position: { x: 1, y: 2, z: 3 },
  modelRunDirection: 1,
  virtualAxes: [{ axis: "v1", kind: "move" }],
} as unknown as SceneObjectConfig;

describe("previewPathPoints", () => {
  it("maps v1 lift (mm) to y (m) offsets", () => {
    const points = previewPathPoints(base, [{ v1: 0 }, { v1: 1000 }]);
    expect(points[0]!.y).toBeCloseTo(2);
    expect(points[1]!.y).toBeCloseTo(3);
  });
  it("inverts for run direction 2", () => {
    const points = previewPathPoints({ ...base, modelRunDirection: 2 } as SceneObjectConfig, [{ v1: 1000 }]);
    expect(points[0]!.y).toBeCloseTo(1);
  });
});
