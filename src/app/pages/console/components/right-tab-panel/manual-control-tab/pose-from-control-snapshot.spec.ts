import { describe, expect, it } from "vitest";
import { poseFromControlSnapshot } from "./pose-from-control-snapshot";

describe("poseFromControlSnapshot", () => {
  it("maps live height from positions.h, ignoring monitor dim values", () => {
    const snapshot = { values: { height: 1234 }, positions: { h: 42, p: 9, y: 8 } };
    expect(poseFromControlSnapshot(snapshot)).toEqual({ v1: 42, v2: 0, v3: 0 });
  });

  it("returns v1 0 when positions are missing", () => {
    const snapshot = { values: { height: 1234 }, positions: null };
    expect(poseFromControlSnapshot(snapshot)).toEqual({ v1: 0, v2: 0, v3: 0 });
  });
});
