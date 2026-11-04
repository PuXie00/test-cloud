import { describe, expect, it } from "vitest";
import { calculateMotionProfileKinematics } from "@/app/project/action-sequence/motion-profile";
import type { MotionProfile } from "@/app/project/action-sequence/types";
import {
  profileFromRates,
  retimeFromRates,
  stepPhaseTime,
  stepRetimedRate,
  stepRetimedSpeed,
  trapezoidRatesOf,
} from "./phase-rates";

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

describe("按速度 sets the duration", () => {
  const paramsOf = (profile: MotionProfile | undefined) =>
    profile?.kind === "trapezoid" ? profile.params : null;

  it("solves the duration from the three rates", () => {
    // 400 走 80 mm/s、加减速度 100：0.8 s 变速 + 4.2 s 匀速 = 5.8 s
    expect(
      retimeFromRates({ distance: 400, acceleration: 100, cruiseSpeed: 80, deceleration: 100 }),
    ).toEqual({ profile: trap(800, 800), durationMs: 5800 });
    expect(
      retimeFromRates({ distance: 400, acceleration: 100, cruiseSpeed: 100, deceleration: 100 }),
    ).toEqual({ profile: trap(1000, 1000), durationMs: 5000 });
  });

  it("rounds the duration to 0.1 s and leaves room for cruising", () => {
    // 正好是三角形（0 s 匀速）：时长往上取一档，速度略低于所填
    const result = retimeFromRates({ distance: 400, acceleration: 100, cruiseSpeed: 200, deceleration: 100 });
    expect(result).not.toBeNull();
    expect(result!.durationMs % 100).toBe(0);
    const params = paramsOf(result!.profile)!;
    expect(params.accelMs + params.decelMs).toBeLessThan(result!.durationMs);
    expect(trapezoidRatesOf(result!.profile, 400, result!.durationMs)!.cruiseSpeed).toBeLessThan(200);
  });

  it("returns null when the distance is too short to reach the speed", () => {
    expect(
      retimeFromRates({ distance: 100, acceleration: 100, cruiseSpeed: 200, deceleration: 100 }),
    ).toBeNull();
    expect(retimeFromRates({ distance: 100, acceleration: 0, cruiseSpeed: 50, deceleration: 100 })).toBeNull();
  });

  it("keeps the pass speeds at the ends", () => {
    const boundary = { startSpeed: 50, endSpeed: 0 };
    const result = retimeFromRates({ distance: 400, boundary, acceleration: 100, cruiseSpeed: 100, deceleration: 100 });
    // 50→100 用 0.5 s 走 37.5，100→0 用 1 s 走 50，匀速 312.5 走 3.125 s：共 4.625 s
    expect(result?.durationMs).toBeGreaterThanOrEqual(4600);
    expect(result?.durationMs).toBeLessThanOrEqual(4700);
    expect(paramsOf(result?.profile)).toEqual({ accelMs: 500, decelMs: 1000 });
  });

  it("steps the cruise speed one 0.1 s of duration at a time", () => {
    const span = { distance: 400, durationMs: 5000 };
    const faster = stepRetimedSpeed({ profile: trap(1000, 1000), ...span, steps: 1 });
    expect(faster?.durationMs).toBe(4900);
    expect(trapezoidRatesOf(faster!.profile, 400, 4900)!.cruiseSpeed).toBeGreaterThan(100);
    const slower = stepRetimedSpeed({ profile: trap(1000, 1000), ...span, steps: -2 });
    expect(slower?.durationMs).toBe(5200);
    expect(trapezoidRatesOf(slower!.profile, 400, 5200)!.cruiseSpeed).toBeLessThan(100);
    expect(stepRetimedSpeed({ profile: trap(1000, 1000), ...span, steps: 0 })).toBeNull();
  });

  it("steps a rate by 0.1 s of its ramp and keeps the cruise speed", () => {
    const span = { distance: 400, durationMs: 5000 };
    const up = stepRetimedRate({ profile: trap(1000, 1000), ...span, phase: "accel", steps: 1 });
    expect(paramsOf(up?.profile)).toEqual({ accelMs: 900, decelMs: 1000 });
    // 加速少 0.1 s，匀速多走 5 → 时长约 4.95 s
    expect([4900, 5000]).toContain(up?.durationMs);
    const rates = trapezoidRatesOf(up!.profile, 400, up!.durationMs)!;
    expect(rates.acceleration).toBeGreaterThan(100);
    expect(Math.abs(rates.cruiseSpeed - 100)).toBeLessThan(3);

    const down = stepRetimedRate({ profile: trap(1000, 1000), ...span, phase: "decel", steps: -2 });
    expect(paramsOf(down?.profile)).toEqual({ accelMs: 1000, decelMs: 1200 });
    expect(down!.durationMs).toBeGreaterThan(5000);
  });

  it("stops at the 0.1 s minimum ramp", () => {
    expect(
      stepRetimedRate({ profile: trap(100, 1000), distance: 400, durationMs: 5000, phase: "accel", steps: 1 }),
    ).toBeNull();
  });
});

describe("stepping a phase time by 0.1 s", () => {
  it("adds or takes 0.1 s per step from the chosen phase only", () => {
    expect(stepPhaseTime(trap(1000, 1000), 5000, "accel", 1)).toEqual(trap(1100, 1000));
    expect(stepPhaseTime(trap(1000, 1000), 5000, "decel", -2)).toEqual(trap(1000, 800));
  });

  it("stops at 0.1 s and before the ramps fill the span, but can still shorten a full one", () => {
    expect(stepPhaseTime(trap(100, 1000), 5000, "accel", -1)).toBeNull();
    expect(stepPhaseTime(trap(2400, 2500), 5000, "accel", 1)).toBeNull();
    expect(stepPhaseTime(trap(3000, 2500), 5000, "accel", -1)).toEqual(trap(2900, 2500));
    expect(stepPhaseTime({ kind: "idle" }, 5000, "accel", 1)).toBeNull();
  });
});
