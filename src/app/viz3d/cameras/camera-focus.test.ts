import { describe, expect, it } from "vitest";
import {
  CameraFlyTo,
  DEFAULT_FOCUS_DURATION_MS,
  mergeFocusBounds,
  resolveFocusFit,
  type FocusBounds,
} from "./camera-focus";

const unitBounds: FocusBounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };

describe("mergeFocusBounds", () => {
  it("returns null for empty input", () => {
    expect(mergeFocusBounds([])).toBeNull();
  });

  it("merges multiple bounds into a single AABB", () => {
    const merged = mergeFocusBounds([
      { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      { min: { x: -2, y: -2, z: -2 }, max: { x: -1, y: -1, z: -1 } },
    ]);
    expect(merged).toEqual({ min: { x: -2, y: -2, z: -2 }, max: { x: 1, y: 1, z: 1 } });
  });
});

describe("resolveFocusFit", () => {
  it("centers on the AABB center", () => {
    const fit = resolveFocusFit(unitBounds, { fov: 0.8, orthographic: false });
    expect(fit.center).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("computes a perspective distance greater than the bounding radius", () => {
    // bounding radius = half diagonal = sqrt(3) ≈ 1.732
    const fit = resolveFocusFit(unitBounds, { fov: 0.8, orthographic: false });
    expect(fit.distance).toBeGreaterThan(1.732);
  });

  it("zooms out further for narrower vertical fov", () => {
    const wide = resolveFocusFit(unitBounds, { fov: 1.2, orthographic: false });
    const narrow = resolveFocusFit(unitBounds, { fov: 0.4, orthographic: false });
    expect(narrow.distance).toBeGreaterThan(wide.distance);
  });

  it("returns an ortho half-height scaled by margin", () => {
    const fit = resolveFocusFit(unitBounds, { fov: 0.8, orthographic: true });
    expect(fit.orthoHalfHeight).toBeCloseTo(Math.sqrt(3) * 1.15, 5);
  });

  it("falls back for invalid fov", () => {
    const fit = resolveFocusFit(unitBounds, { fov: 0, orthographic: false });
    expect(fit.distance).toBeGreaterThan(0);
  });
});

describe("CameraFlyTo", () => {
  const from = { target: { x: 0, y: 0, z: 0 }, distance: 10, orthoHalfHeight: 5 };
  const to = { target: { x: 4, y: 0, z: 0 }, distance: 20, orthoHalfHeight: 10 };

  it("interpolates from start to end and completes", () => {
    const fly = new CameraFlyTo();
    fly.start(from, to, DEFAULT_FOCUS_DURATION_MS, 0);
    expect(fly.active).toBe(true);

    const first = fly.sample(0);
    expect(first?.done).toBe(false);
    expect(first?.frame.target.x).toBeCloseTo(0, 5);
    expect(first?.frame.distance).toBeCloseTo(10, 5);

    const done = fly.sample(DEFAULT_FOCUS_DURATION_MS);
    expect(done?.done).toBe(true);
    expect(done?.frame.target.x).toBeCloseTo(4, 5);
    expect(done?.frame.distance).toBeCloseTo(20, 5);
    expect(fly.active).toBe(false);
  });

  it("monotonically approaches the target distance", () => {
    const fly = new CameraFlyTo();
    fly.start(from, to, DEFAULT_FOCUS_DURATION_MS, 0);
    const a = fly.sample(DEFAULT_FOCUS_DURATION_MS * 0.25)!.frame.distance;
    const b = fly.sample(DEFAULT_FOCUS_DURATION_MS * 0.5)!.frame.distance;
    const c = fly.sample(DEFAULT_FOCUS_DURATION_MS * 0.75)!.frame.distance;
    expect(a).toBeLessThanOrEqual(b);
    expect(b).toBeLessThanOrEqual(c);
  });

  it("returns null after cancel", () => {
    const fly = new CameraFlyTo();
    fly.start(from, to, DEFAULT_FOCUS_DURATION_MS, 0);
    fly.cancel();
    expect(fly.active).toBe(false);
    expect(fly.sample(DEFAULT_FOCUS_DURATION_MS)).toBeNull();
  });
});
