import { describe, expect, it } from "vitest";
import { MOTION_DEFAULTS } from "./configuration-rules";
import {
  DEFAULT_SWING_AXIS_MAX_VELOCITY,
  UNBOUND_V1_MAX_VELOCITY,
  clampMotionParamsToAxisMax,
  resolveJogAxisMaxVelocity,
  normalizeAxisDefaultMaxVelocity,
  resolveVirtualAxisMaxVelocity,
  swingAxisMaxVelocityOf,
  withSwingAxisMaxVelocity,
} from "./virtual-axis-max-velocity";

const object = {
  id: 8,
  enabledVirtualAxes: ["v1", "v2", "v3"] as const,
  motionParams: {
    h: { ...MOTION_DEFAULTS.move },
    p: { ...MOTION_DEFAULTS.swingX, defaultMaxVelocity: 4 },
    y: { ...MOTION_DEFAULTS.yawY, defaultMaxVelocity: 5 },
  },
};

const motor = (
  objectId: number | null,
  maxAxisVelocity: unknown,
): { controlledObjectId: number | null; params: Record<string, unknown> } => ({
  controlledObjectId: objectId,
  params: { maxAxisVelocity },
});

describe("resolveVirtualAxisMaxVelocity", () => {
  it("v1 is the min positive bound-motor maxAxisVelocity", () => {
    const resolved = resolveVirtualAxisMaxVelocity(object, [
      motor(8, 400),
      motor(8, 250),
      motor(9, 100),
    ]);
    expect(resolved.v1).toBe(250);
    expect(resolved.v2).toBe(4);
    expect(resolved.v3).toBe(5);
  });

  it("v1 is 500 when no bound motors have a positive maxAxisVelocity", () => {
    const resolved = resolveVirtualAxisMaxVelocity(
      { id: 1, enabledVirtualAxes: ["v1"] },
      [motor(1, 0), motor(1, -10), motor(1, undefined), motor(2, 80)],
    );
    expect(resolved).toEqual({ v1: UNBOUND_V1_MAX_VELOCITY });
  });

  it("omits v2/v3 when those axes are not enabled", () => {
    expect(
      resolveVirtualAxisMaxVelocity({ id: 1, enabledVirtualAxes: ["v1"] }, []),
    ).toEqual({ v1: UNBOUND_V1_MAX_VELOCITY });
  });
});

describe("normalizeAxisDefaultMaxVelocity", () => {
  it("fills defaults on p / y and strips the field from h", () => {
    const { defaultMaxVelocity: _drop, ...swingWithout } = MOTION_DEFAULTS.swingX;
    expect(normalizeAxisDefaultMaxVelocity("p", swingWithout).defaultMaxVelocity).toBe(
      DEFAULT_SWING_AXIS_MAX_VELOCITY,
    );
    expect(
      normalizeAxisDefaultMaxVelocity("y", { ...MOTION_DEFAULTS.yawY, defaultMaxVelocity: 9 })
        .defaultMaxVelocity,
    ).toBe(9);
    expect(
      normalizeAxisDefaultMaxVelocity("h", { ...MOTION_DEFAULTS.move, defaultMaxVelocity: 9 }),
    ).not.toHaveProperty("defaultMaxVelocity");
  });
});

describe("swingAxisMaxVelocityOf / withSwingAxisMaxVelocity", () => {
  it("reads and writes v2 on p and v3 on y", () => {
    expect(swingAxisMaxVelocityOf(object.motionParams, "v2")).toBe(4);
    expect(swingAxisMaxVelocityOf(object.motionParams, "v3")).toBe(5);
    const next = withSwingAxisMaxVelocity(object.motionParams, "v3", 7);
    expect(next.y?.defaultMaxVelocity).toBe(7);
    expect(object.motionParams.y.defaultMaxVelocity).toBe(5);
    expect(withSwingAxisMaxVelocity(object.motionParams, "v2", 6).p?.defaultMaxVelocity).toBe(6);
  });

  it("leaves motionParams unchanged when the axis is absent", () => {
    const params = { h: { ...MOTION_DEFAULTS.move } };
    expect(withSwingAxisMaxVelocity(params, "v2", 6)).toBe(params);
    expect(swingAxisMaxVelocityOf(params, "v2")).toBeUndefined();
  });
});

describe("clampMotionParamsToAxisMax", () => {
  it("caps swing speeds to resolved v2/v3", () => {
    const next = clampMotionParamsToAxisMax(
      {
        h: { ...MOTION_DEFAULTS.move, speed: 80 },
        p: { ...MOTION_DEFAULTS.swingX, speed: 9 },
        y: { ...MOTION_DEFAULTS.yawY, speed: 1 },
      },
      { v1: 50, v2: 3, v3: 5 },
    );
    expect(next.h?.speed).toBe(50);
    expect(next.p?.speed).toBe(3);
    expect(next.y?.speed).toBe(1);
  });
});

describe("resolveJogAxisMaxVelocity", () => {
  it("takes the min resolved cap across selected objects", () => {
    const withV2 = (id: number, defaultMaxVelocity: number) => ({
      id,
      enabledVirtualAxes: ["v1", "v2"] as const,
      motionParams: { p: { ...MOTION_DEFAULTS.swingX, defaultMaxVelocity } },
    });
    const a = withV2(1, 6);
    const b = withV2(2, 4);
    expect(resolveJogAxisMaxVelocity("v2", [a, b], [])).toBe(4);
    expect(resolveJogAxisMaxVelocity("v1", [a], [motor(1, 120)])).toBe(120);
    expect(resolveJogAxisMaxVelocity("v3", [a], [])).toBeUndefined();
  });
});
