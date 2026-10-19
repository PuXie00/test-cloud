import { describe, expect, it } from "vitest";
import { calculateMotionProfileKinematics } from "@/app/project/action-sequence/motion-profile";
import type { MotionProfile } from "@/app/project/action-sequence/types";
import { profileFromRates, trapezoidRatesOf } from "./phase-rates";

const trap = (accelMs: number, decelMs: number): MotionProfile => ({
  kind: "trapezoid",
  params: { accelMs, decelMs },
});

describe("phase rates", () => {
  it("reads the acceleration, cruise speed and deceleration of a trapezoid", () => {
    const rates = trapezoidRatesOf(trap(1000, 1000), 400, 5000);
    const kinematics = calculateMotionProfileKinematics(trap(1000, 1000), 400, 5000);
    expect(rates).toEqual({
      acceleration: kinematics.acceleration,
      cruiseSpeed: kinematics.peakVelocity,
      deceleration: kinematics.deceleration,
    });
  });

  it("reads the cruise speed, not the entry speed, when the span has pass speeds", () => {
    const rates = trapezoidRatesOf(trap(1000, 1000), 400, 5000, { startSpeed: 150, endSpeed: 0 });
    expect(rates?.cruiseSpeed).toBeLessThan(150);
    expect(rates?.acceleration).toBeCloseTo(150 - rates!.cruiseSpeed, 9);
  });

  it("has no rates without travel or for an idle axis", () => {
    expect(trapezoidRatesOf(trap(1000, 1000), 0, 5000)).toBeNull();
    expect(trapezoidRatesOf({ kind: "idle" }, 100, 5000)).toBeNull();
  });

  it("rounds the phase times it solves for to 0.1 s", () => {
    // 400 mm in 5 s at 100 mm/s²: v = 100·(5 − √(25 − 16))/2 = 100 → 1 s ramps
    expect(
      profileFromRates({ distance: 400, durationMs: 5000, acceleration: 100, deceleration: 100 }),
    ).toEqual(trap(1000, 1000));
    // 1.27 s / 0.6 s exactly → 1.3 s / 0.6 s
    const exact = trap(1270, 600);
    const kinematics = calculateMotionProfileKinematics(exact, 300, 5000);
    expect(
      profileFromRates({
        distance: 300,
        durationMs: 5000,
        acceleration: kinematics.acceleration,
        deceleration: kinematics.deceleration,
      }),
    ).toEqual(trap(1300, 600));
  });

  it("keeps each phase at least 0.1 s and leaves room for cruising", () => {
    const steep = profileFromRates({
      distance: 100,
      durationMs: 1000,
      acceleration: 1e6,
      deceleration: 1e6,
    });
    expect(steep).toEqual(trap(100, 100));
    // 几乎是三角形：取整后两段变速不能占满时长
    const triangle = profileFromRates({
      distance: 249,
      durationMs: 1000,
      acceleration: 1000,
      deceleration: 1000,
    });
    expect(triangle?.kind).toBe("trapezoid");
    if (triangle?.kind !== "trapezoid") return;
    expect(triangle.params.accelMs + triangle.params.decelMs).toBeLessThan(1000);
  });

  it("returns null when the rates cannot fit the span", () => {
    expect(
      profileFromRates({ distance: 100, durationMs: 1000, acceleration: 10, deceleration: 10 }),
    ).toBeNull();
  });
});

describe("rounding the solved phase times", () => {
  it("never ends up above the rates that were asked for when a combination below exists", () => {
    // 2 s 走 200：精确解是 0.52 s / 0.42 s，四舍五入成 0.5 s / 0.4 s 会两边都超 3%
    const profile = profileFromRates({
      distance: 200,
      durationMs: 2000,
      acceleration: 250,
      deceleration: 312.5,
    });
    expect(profile).toEqual(trap(600, 500));
    const rates = trapezoidRatesOf(profile!, 200, 2000)!;
    expect(rates.acceleration).toBeLessThanOrEqual(250);
    expect(rates.deceleration).toBeLessThanOrEqual(312.5);
  });

  it("takes the closest combination when every one of them overshoots a little", () => {
    const profile = profileFromRates({
      distance: 400,
      durationMs: 4000,
      acceleration: 156.25,
      deceleration: 100,
    });
    expect(profile).toEqual(trap(900, 1400));
    const rates = trapezoidRatesOf(profile!, 400, 4000)!;
    expect(rates.deceleration).toBeCloseTo(100.25, 2);
  });
});
