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
    expect(STROKE_LIMITS.multiPointSwing.y).toEqual({
      minStroke: { min: 0, max: 0 },
      maxStroke: { min: 360, max: 4294967295 },
      maxStrokeMultiple: 360,
    });
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
    expect(strokeLimitsFor(["dualTiltFourPointSwing", "multiPointSwing"], "y")).toEqual({
      minStroke: { min: 0, max: 0 },
      maxStroke: { min: 360, max: 4294967295 },
      maxStrokeMultiple: 360,
    });
    expect(strokeLimitsFor(["railCar"], "h")).toBeUndefined();
  });

  it("keeps the endless yaw axis at 0 to a multiple of 360", () => {
    const yaw = (minAngle: number, maxAngle: number) => ({ ...MOTION_DEFAULTS.yawY, minAngle, maxAngle });
    const limits = STROKE_LIMITS.multiPointSwing.y;
    expect(clampStroke(yaw(-20, 20), limits)).toMatchObject({ minAngle: 0, maxAngle: 360 });
    expect(clampStroke(yaw(0, 500), limits)).toMatchObject({ maxAngle: 360 });
    expect(clampStroke(yaw(0, 540), limits)).toMatchObject({ maxAngle: 720 });
    expect(clampStroke(yaw(-360, 1080), limits)).toMatchObject({ minAngle: 0, maxAngle: 1080 });
    const inside = yaw(0, 720);
    expect(clampStroke(inside, limits)).toBe(inside);
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
