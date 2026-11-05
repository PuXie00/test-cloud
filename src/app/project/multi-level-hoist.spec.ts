import { describe, expect, it } from "vitest";
import {
  adjustDistancesForPlc,
  nextAdjustDistance,
  normalizeMultiLevelConfig,
  resolveMultiLevelParams,
  setAdjustDistance,
} from "./multi-level-hoist";

const stroke = { min: 0, max: 1000 };

describe("multi-level hoist config", () => {
  it("normalizes stored config: sorted unique points, at most 10, ratio 0-100", () => {
    expect(
      normalizeMultiLevelConfig({ adjustDistances: [300, 100, 300, 200.04, Number.NaN], decelerationRatio: 140 }),
    ).toEqual({ adjustDistances: [100, 200, 300], decelerationRatio: 100 });
    expect(normalizeMultiLevelConfig(undefined)).toEqual({ adjustDistances: [], decelerationRatio: 50 });
    expect(
      normalizeMultiLevelConfig({ adjustDistances: Array.from({ length: 12 }, (_, i) => i + 1) }).adjustDistances,
    ).toHaveLength(10);
  });

  it("only multi-level hoists carry it", () => {
    expect(resolveMultiLevelParams("multiLevelHoist")).toEqual({
      multiLevel: { adjustDistances: [], decelerationRatio: 50 },
    });
    expect(resolveMultiLevelParams("singlePointMove", { multiLevel: { adjustDistances: [1] } })).toEqual({});
  });

  it("keeps points strictly increasing inside the stroke", () => {
    expect(setAdjustDistance([200, 600], 1, 100, stroke)).toEqual({ ok: true, adjustDistances: [100, 200] });
    expect(setAdjustDistance([200, 600], 2, 400, stroke)).toEqual({ ok: true, adjustDistances: [200, 400, 600] });
    expect(setAdjustDistance([200, 600], 1, 200, stroke)).toMatchObject({ ok: false });
    expect(setAdjustDistance([200], 1, 1000, stroke)).toMatchObject({ ok: false });
    expect(setAdjustDistance([200], 1, 0, stroke)).toMatchObject({ ok: false });
    const ten = Array.from({ length: 10 }, (_, i) => (i + 1) * 50);
    expect(setAdjustDistance(ten, 10, 999, stroke)).toMatchObject({ ok: false, reason: "最多 10 个分段点" });
  });

  it("suggests a new point in the middle of the widest gap", () => {
    expect(nextAdjustDistance([], stroke)).toBe(500);
    expect(nextAdjustDistance([500], stroke)).toBe(250);
    expect(nextAdjustDistance([100, 900], stroke)).toBe(500);
    expect(nextAdjustDistance([], { min: 0, max: 0.1 })).toBeNull();
  });

  it("sends only the points that are still inside the stroke", () => {
    expect(adjustDistancesForPlc([100, 600, 1200], { min: 0, max: 800 })).toEqual([100, 600]);
  });
});
