import { describe, expect, it } from "vitest";
import { poseFromControlSnapshot } from "./pose-from-control-snapshot";

const dims = (count: number) =>
  ["height", "pitch", "yaw"].slice(0, count).map((key) => ({ key, label: key, unit: "mm" }));

describe("poseFromControlSnapshot", () => {
  it("maps live h / p / y to v1 / v2 / v3 for a three-axis object", () => {
    const snapshot = { descriptor: { dimensions: dims(3) }, positions: { h: 42, p: 9, y: 8 } };
    expect(poseFromControlSnapshot(snapshot)).toEqual({ v1: 42, v2: 9, v3: 8 });
  });

  it("leaves axes the object doesn't have at 0", () => {
    const snapshot = { descriptor: { dimensions: dims(1) }, positions: { h: 42, p: 9, y: 8 } };
    expect(poseFromControlSnapshot(snapshot)).toEqual({ v1: 42, v2: 0, v3: 0 });
  });

  it("returns zeros when positions are missing", () => {
    const snapshot = { descriptor: { dimensions: dims(3) }, positions: null };
    expect(poseFromControlSnapshot(snapshot)).toEqual({ v1: 0, v2: 0, v3: 0 });
  });
});
