import { describe, expect, it } from "vitest";
import { MOTION_DEFAULTS } from "./configuration-rules";
import { clampStroke, STROKE_LIMITS, strokeLimitsFor } from "./stroke-limits";

describe("stroke limits by object type", () => {
  it("follows the master description of each type", () => {
    expect(STROKE_LIMITS.multiLevelHoist.h).toEqual({
      minStroke: { min: -200000, max: 0 },
      maxStroke: { min: 0, max: 200000 },
    });
    expect(STROKE_LIMITS.singlePointMove.h?.minStroke.min).toBe(0);
    expect(STROKE_LIMITS.singlePointRotation.h?.minStroke.min).toBe(0);
    expect(STROKE_LIMITS.continuousRotation.h?.maxStroke.min).toBe(0);
    expect(STROKE_LIMITS.multiPointSwing.p?.minStroke).toEqual({ min: -89.9, max: 0 });
    expect(STROKE_LIMITS.multiPointSwing.y?.minStroke).toEqual({ min: -3000, max: 0 });
    expect(STROKE_LIMITS.dualTiltFourPointSwing.p?.minStroke).toEqual({ min: -89.9, max: 0 });
    expect(STROKE_LIMITS.dualTiltFourPointSwing.y?.minStroke).toEqual({ min: -89.9, max: 0 });
    expect(STROKE_LIMITS.railCar).toEqual({});
    expect(STROKE_LIMITS.staticProp).toEqual({});
  });

  it("intersects the limits of several types for batch editing", () => {
    expect(strokeLimitsFor(["multiLevelHoist", "singlePointMove"], "h")).toEqual({
      minStroke: { min: 0, max: 0 },
      maxStroke: { min: 0, max: 200000 },
    });
    expect(strokeLimitsFor(["multiPointSwing", "dualTiltFourPointSwing"], "y")?.minStroke).toEqual({
      min: -89.9,
      max: 0,
    });
    expect(strokeLimitsFor(["railCar"], "h")).toBeUndefined();
  });

  it("clamps kept parameters into the new type's range", () => {
    const params = { ...MOTION_DEFAULTS.move, minAngle: -500, maxAngle: 300000 };
    expect(clampStroke(params, STROKE_LIMITS.multiLevelHoist.h)).toMatchObject({
      minAngle: -500,
      maxAngle: 200000,
    });
    expect(clampStroke(params, STROKE_LIMITS.singlePointMove.h)).toMatchObject({ minAngle: 0 });
    const inside = { ...MOTION_DEFAULTS.swingX };
    expect(clampStroke(inside, STROKE_LIMITS.multiPointSwing.p)).toBe(inside);
  });
});
