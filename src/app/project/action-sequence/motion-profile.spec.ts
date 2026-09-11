import { describe, expect, it } from "vitest";
import type { MotionProfile, TrapezoidAxisProfile } from "./types";
import {
  applyTrapezoidHandleDrag,
  calculateMotionProfileKinematics,
  cloneAxisProfiles,
  cloneMotionProfile,
  createDefaultAxisProfile,
  createDefaultAxisProfiles,
  createIdleAxisProfile,
  cruiseMsOf,
  syncAxisProfileToTravel,
  evaluateMotionProfile,
  motionProfilePhaseBoundaries,
  ratiosFromProfile,
  sampleVelocityNorm,
  trapezoidHandles,
  validateMotionProfile,
  withTrapezoidAccelMs,
  withTrapezoidDecelMs,
} from "./motion-profile";

const trap = (accelMs = 200, decelMs = 200): TrapezoidAxisProfile => ({
  kind: "trapezoid",
  params: { accelMs, decelMs },
});

const idle = (): MotionProfile => ({ kind: "idle" });

describe("trapezoid axis motion profile", () => {
  it("defaults from minAccelTime in milliseconds", () => {
    expect(createDefaultAxisProfile(5000, 1).params).toEqual({ accelMs: 1000, decelMs: 1000 });
  });

  it("still writes minAccelTime when duration is too short", () => {
    expect(createDefaultAxisProfile(500, 1).params).toEqual({ accelMs: 1000, decelMs: 1000 });
  });

  it("defaults to 20% of duration when minAccelTime is missing", () => {
    const first = createDefaultAxisProfile(1000);
    const second = createDefaultAxisProfile(1000);
    expect(first).toEqual({
      kind: "trapezoid",
      params: { accelMs: 200, decelMs: 200 },
    });
    expect(first).not.toBe(second);
    expect(first.params).not.toBe(second.params);
    expect(cruiseMsOf(first, 1000)).toBe(600);
  });

  it("defaults to 1 ms phases when duration is not positive", () => {
    expect(createDefaultAxisProfile(0).params).toEqual({ accelMs: 1, decelMs: 1 });
    expect(createDefaultAxisProfile(-100).params).toEqual({ accelMs: 1, decelMs: 1 });
  });

  it("creates per-axis defaults from minAccelTimeByAxis", () => {
    const profiles = createDefaultAxisProfiles(4000, { v1: 1, v2: 0.5 });
    expect(profiles.v1.params).toEqual({ accelMs: 1000, decelMs: 1000 });
    expect(profiles.v2.params).toEqual({ accelMs: 500, decelMs: 500 });
    expect(profiles.v3.params).toEqual({ accelMs: 800, decelMs: 800 });
    expect(profiles.v1.params).not.toBe(profiles.v2.params);
  });

  it("converts stored milliseconds to ratios only when duration is positive", () => {
    expect(ratiosFromProfile(trap(200, 200), 1000)).toEqual({
      accelRatio: 0.2,
      decelRatio: 0.2,
    });
    expect(ratiosFromProfile(trap(600, 600), 3000)).toEqual({
      accelRatio: 0.2,
      decelRatio: 0.2,
    });
    expect(ratiosFromProfile(trap(200, 200), 0)).toBeNull();
    expect(ratiosFromProfile(trap(200, 200), -1)).toBeNull();
  });

  it("derives cruise milliseconds including non-positive cruise", () => {
    expect(cruiseMsOf(trap(200, 200), 1000)).toBe(600);
    expect(cruiseMsOf(trap(200, 200), 300)).toBe(-100);
  });

  it("evaluates exact symmetric phase boundaries", () => {
    const profile = trap(200, 200);
    expect(evaluateMotionProfile(profile, 0, 1000)).toBe(0);
    expect(evaluateMotionProfile(profile, 0.2, 1000)).toBeCloseTo(0.125, 10);
    expect(evaluateMotionProfile(profile, 0.8, 1000)).toBeCloseTo(0.875, 10);
    expect(evaluateMotionProfile(profile, 1, 1000)).toBe(1);
    expect(motionProfilePhaseBoundaries(profile, 1000)).toEqual([0.2, 0.8]);
  });

  it("throws when duration cannot form a legal cruise for evaluation", () => {
    expect(() => evaluateMotionProfile(trap(200, 200), 0.5, 0)).toThrow(
      new Error("invalid trapezoid motion profile"),
    );
    expect(() => evaluateMotionProfile(trap(500, 500), 0.5, 1000)).toThrow(
      new Error("invalid trapezoid motion profile"),
    );
  });

  it("clones a profile and axis set with independent references", () => {
    const source = trap(200, 200);
    const cloned = cloneMotionProfile(source);
    expect(cloned).toEqual(source);
    expect(cloned).not.toBe(source);
    if (cloned.kind !== "trapezoid") throw new Error("expected trapezoid clone");
    expect(cloned.params).not.toBe(source.params);

    const axisSource = createDefaultAxisProfiles(1000);
    const axisCloned = cloneAxisProfiles(axisSource);
    expect(axisCloned).toEqual(axisSource);
    expect(axisCloned).not.toBe(axisSource);
    expect(axisCloned.v1).not.toBe(axisSource.v1);
    if (axisCloned.v1.kind !== "trapezoid" || axisSource.v1.kind !== "trapezoid") {
      throw new Error("expected trapezoid");
    }
    expect(axisCloned.v1.params).not.toBe(axisSource.v1.params);
  });

  it("is continuous and monotonic for an asymmetric profile", () => {
    const profile = trap(100, 300);
    const values = Array.from({ length: 101 }, (_, index) =>
      evaluateMotionProfile(profile, index / 100, 1000),
    );
    expect(values.every((value, index) => index === 0 || value >= values[index - 1]!)).toBe(true);
    expect(evaluateMotionProfile(profile, 0.1 - 1e-8, 1000)).toBeCloseTo(
      evaluateMotionProfile(profile, 0.1 + 1e-8, 1000),
      6,
    );
    expect(evaluateMotionProfile(profile, 0.7 - 1e-8, 1000)).toBeCloseTo(
      evaluateMotionProfile(profile, 0.7 + 1e-8, 1000),
      6,
    );
  });

  it("rejects non-finite or non-positive milliseconds without requiring cruise", () => {
    expect(validateMotionProfile({
      kind: "trapezoid",
      params: { accelMs: 0, decelMs: 200 },
    })).not.toEqual([]);
    expect(validateMotionProfile({
      kind: "trapezoid",
      params: { accelMs: Number.NaN, decelMs: 200 },
    })).not.toEqual([]);
    expect(validateMotionProfile(trap(600, 600))).toEqual([]);
  });

  it("calculates peak velocity, acceleration, and deceleration from durationMs", () => {
    const result = calculateMotionProfileKinematics(trap(600, 600), 900, 3000);
    expect(result.peakVelocity).toBeCloseTo(375, 10);
    expect(result.acceleration).toBeCloseTo(625, 10);
    expect(result.deceleration).toBeCloseTo(625, 10);
    expect(result.accelDurationSec).toBeCloseTo(0.6, 10);
    expect(result.cruiseDurationSec).toBeCloseTo(1.8, 10);
    expect(result.decelDurationSec).toBeCloseTo(0.6, 10);
  });

  it("samples 20/60/20 relative velocity when duration is 1000", () => {
    const p = trap(200, 200);
    expect(sampleVelocityNorm(p, 0, 1000)).toBe(0);
    expect(sampleVelocityNorm(p, 0.2, 1000)).toBeCloseTo(1, 10);
    expect(sampleVelocityNorm(p, 0.5, 1000)).toBeCloseTo(1, 10);
    expect(sampleVelocityNorm(p, 0.8, 1000)).toBeCloseTo(1, 10);
    expect(sampleVelocityNorm(p, 1, 1000)).toBe(0);
    expect(sampleVelocityNorm(p, 0.1, 1000)).toBeCloseTo(0.5, 10);
    expect(sampleVelocityNorm(p, 0.9, 1000)).toBeCloseTo(0.5, 10);
  });

  it("throws for unsupported motion profile kind in sampleVelocityNorm", () => {
    const fake = { kind: "unknown", params: { accelMs: 200, decelMs: 200 } } as unknown as MotionProfile;
    expect(() => sampleVelocityNorm(fake, 0.5, 1000)).toThrow(
      new Error("unsupported motion profile kind"),
    );
  });

  it("returns trapezoid handles for default 20/60/20", () => {
    expect(trapezoidHandles(trap(200, 200), 1000)).toEqual([
      { id: "accel-end", tNorm: 0.2 },
      { id: "decel-start", tNorm: 0.8 },
    ]);
  });

  it("clamps accel-end drag so cruise stays positive when duration is enough", () => {
    const next = applyTrapezoidHandleDrag(trap(200, 200), "accel-end", 0.95, 1000);
    if (next.kind !== "trapezoid") throw new Error("expected trapezoid");
    expect(next.params.accelMs + next.params.decelMs).toBeLessThan(1000);
    expect(next.params.decelMs).toBeCloseTo(200, 10);
    expect(next.params.accelMs).toBeGreaterThan(0);
  });

  it("clamps decel-start drag so cruise stays positive when duration is enough", () => {
    const next = applyTrapezoidHandleDrag(trap(200, 200), "decel-start", 0.05, 1000);
    if (next.kind !== "trapezoid") throw new Error("expected trapezoid");
    expect(next.params.accelMs + next.params.decelMs).toBeLessThan(1000);
    expect(next.params.accelMs).toBeCloseTo(200, 10);
    expect(next.params.decelMs).toBeGreaterThan(0);
  });

  it("floors handle drag at minAccelMs when duration is enough", () => {
    const accel = applyTrapezoidHandleDrag(trap(200, 200), "accel-end", 0.05, 1000, 100);
    if (accel.kind !== "trapezoid") throw new Error("expected trapezoid");
    expect(accel.params.accelMs).toBe(100);
    expect(accel.params.decelMs).toBe(200);

    const decel = applyTrapezoidHandleDrag(trap(200, 200), "decel-start", 0.95, 1000, 100);
    if (decel.kind !== "trapezoid") throw new Error("expected trapezoid");
    expect(decel.params.decelMs).toBe(100);
    expect(decel.params.accelMs).toBe(200);
  });

  it("writes requested time when duration cannot fit a legal cruise", () => {
    const next = applyTrapezoidHandleDrag(trap(200, 200), "accel-end", 0.5, 300, 200);
    if (next.kind !== "trapezoid") throw new Error("expected trapezoid");
    expect(next.params.accelMs).toBeCloseTo(150, 10);
    expect(next.params.decelMs).toBe(200);
    expect(next.params.accelMs + next.params.decelMs).toBeGreaterThan(300);
  });

  it("withTrapezoidAccelMs rejects non-positive values but allows cruise <= 0", () => {
    const profile = trap(200, 200);
    expect(withTrapezoidAccelMs(profile, 0)).toBeNull();
    expect(withTrapezoidAccelMs(profile, Number.NaN)).toBeNull();
    expect(withTrapezoidAccelMs(profile, 900)).toEqual({
      kind: "trapezoid",
      params: { accelMs: 900, decelMs: 200 },
    });
  });

  it("withTrapezoidDecelMs rejects non-positive values but allows cruise <= 0", () => {
    const profile = trap(200, 200);
    expect(withTrapezoidDecelMs(profile, 0)).toBeNull();
    expect(withTrapezoidDecelMs(profile, Number.NaN)).toBeNull();
    expect(withTrapezoidDecelMs(profile, 900)).toEqual({
      kind: "trapezoid",
      params: { accelMs: 200, decelMs: 900 },
    });
  });
});

describe("idle axis motion profile", () => {
  it("validateMotionProfile accepts idle and still rejects trapezoid accelMs 0", () => {
    expect(validateMotionProfile(idle())).toEqual([]);
    expect(validateMotionProfile({
      kind: "trapezoid",
      params: { accelMs: 0, decelMs: 200 },
    })).not.toEqual([]);
  });

  it("idle sampling and evaluation are identically zero", () => {
    expect(sampleVelocityNorm(idle(), 0, 1000)).toBe(0);
    expect(sampleVelocityNorm(idle(), 0.5, 1000)).toBe(0);
    expect(sampleVelocityNorm(idle(), 1, 1000)).toBe(0);
    expect(evaluateMotionProfile(idle(), 0.5, 1000)).toBe(0);
    expect(motionProfilePhaseBoundaries(idle(), 1000)).toEqual([]);
  });

  it("idle kinematics are zeros with cruise equal to duration", () => {
    const result = calculateMotionProfileKinematics(idle(), 0, 3000);
    expect(result).toEqual({
      peakVelocity: 0,
      acceleration: 0,
      deceleration: 0,
      accelDurationSec: 0,
      cruiseDurationSec: 3,
      decelDurationSec: 0,
    });
  });

  it("cloneMotionProfile clones idle without params", () => {
    const source = idle();
    const cloned = cloneMotionProfile(source);
    expect(cloned).toEqual({ kind: "idle" });
    expect(cloned).not.toBe(source);
  });

  it("syncAxisProfileToTravel writes idle at 0 travel and restores default trapezoid from idle", () => {
    expect(syncAxisProfileToTravel(trap(200, 200), 0, 5000, 1)).toEqual({ kind: "idle" });
    expect(syncAxisProfileToTravel({ kind: "idle" }, 100, 5000, 1)).toEqual({
      kind: "trapezoid",
      params: { accelMs: 1000, decelMs: 1000 },
    });
    const moving = trap(300, 400);
    expect(syncAxisProfileToTravel(moving, 50, 5000, 1)).toEqual(moving);
  });

  it("createIdleAxisProfile returns a distinct idle object", () => {
    expect(createIdleAxisProfile()).toEqual({ kind: "idle" });
    expect(createIdleAxisProfile()).not.toBe(createIdleAxisProfile());
  });
});
