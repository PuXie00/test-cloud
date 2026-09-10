import { describe, expect, it } from "vitest";
import { MOTION_DEFAULTS } from "./configuration-rules";
import {
  DEFAULT_SWING_AXIS_MAX_VELOCITY,
  UNBOUND_V1_MAX_VELOCITY,
  clampMotionParamsToAxisMax,
  resolveJogAxisMaxVelocity,
  resolveVirtualAxisMaxVelocity,
  virtualAxisMaxFieldsFor,
} from "./virtual-axis-max-velocity";

const object = {
  id: 8,
  enabledVirtualAxes: ["v1", "v2", "v3"] as const,
  pMaxVelocity: 4,
  yMaxVelocity: 5,
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

describe("virtualAxisMaxFieldsFor", () => {
  it("adds defaults for enabled swing axes and strips disabled ones", () => {
    expect(virtualAxisMaxFieldsFor(["v1"])).toEqual({});
    expect(virtualAxisMaxFieldsFor(["v1", "v2"])).toEqual({
      pMaxVelocity: DEFAULT_SWING_AXIS_MAX_VELOCITY,
    });
    expect(
      virtualAxisMaxFieldsFor(["v1", "v2", "v3"], { pMaxVelocity: 9, yMaxVelocity: 8 }),
    ).toEqual({ pMaxVelocity: 9, yMaxVelocity: 8 });
    expect(virtualAxisMaxFieldsFor(["v1"], { pMaxVelocity: 9, yMaxVelocity: 8 })).toEqual({});
  });
});

describe("clampMotionParamsToAxisMax", () => {
  it("caps swing speeds to resolved v2/v3", () => {
    const next = clampMotionParamsToAxisMax(
      {
        move: { ...MOTION_DEFAULTS.move, speed: 80 },
        swingX: { ...MOTION_DEFAULTS.swingX, speed: 9 },
        yawY: { ...MOTION_DEFAULTS.yawY, speed: 1 },
      },
      ["move", "swingX", "yawY"],
      { v1: 50, v2: 3, v3: 5 },
    );
    expect(next.move?.speed).toBe(50);
    expect(next.swingX?.speed).toBe(3);
    expect(next.yawY?.speed).toBe(1);
  });
});

describe("resolveJogAxisMaxVelocity", () => {
  it("takes the min resolved cap across selected objects", () => {
    const a = { id: 1, enabledVirtualAxes: ["v1", "v2"] as const, pMaxVelocity: 6 };
    const b = { id: 2, enabledVirtualAxes: ["v1", "v2"] as const, pMaxVelocity: 4 };
    expect(resolveJogAxisMaxVelocity("v2", [a, b], [])).toBe(4);
    expect(resolveJogAxisMaxVelocity("v1", [a], [motor(1, 120)])).toBe(120);
    expect(resolveJogAxisMaxVelocity("v3", [a], [])).toBeUndefined();
  });
});
