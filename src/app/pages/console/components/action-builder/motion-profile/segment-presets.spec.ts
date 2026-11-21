import { describe, expect, it } from "vitest";
import type { MotionProfile } from "@/app/project/action-sequence/types";
import { trapezoidRatesOf } from "./phase-rates";
import {
  matchingRampPreset,
  presetRate,
  profileForDuration,
  rampPresetOf,
  referencePlan,
  withRampPreset,
  type AxisRateLimits,
  type SegmentRampAxis,
} from "./segment-presets";

const trap = (accelMs: number, decelMs: number): MotionProfile => ({
  kind: "trapezoid",
  params: { accelMs, decelMs },
});

// 搭建：默认 100 mm/s、100 mm/s²；上限 400 mm/s、400 mm/s²
const limits: AxisRateLimits = { defaultSpeed: 100, defaultAccel: 100, maxSpeed: 400, maxAccel: 400 };

// 5 s 走 400 mm，1 s 加减速：匀速 100 mm/s，加减速度正好是默认的 100 mm/s²
const axis = (profile: MotionProfile = trap(1000, 1000), extra: Partial<SegmentRampAxis> = {}) => ({
  axis: "v1" as const,
  profile,
  distance: 400,
  durationMs: 5000,
  limits,
  ...extra,
});

describe("presetRate", () => {
  it("halves and doubles the configured acceleration", () => {
    expect(presetRate(limits, "standard")).toBe(100);
    expect(presetRate(limits, "soft")).toBe(50);
    expect(presetRate(limits, "quick")).toBe(200);
  });

  it("keeps 快 under 95% of the limit and never below 标准", () => {
    expect(presetRate({ defaultAccel: 300, maxAccel: 400 }, "quick")).toBe(380);
    expect(presetRate({ defaultAccel: 500, maxAccel: 400 }, "standard")).toBe(400);
    expect(presetRate({ defaultAccel: 500, maxAccel: 400 }, "quick")).toBe(400);
  });

  it("has no presets without a configured acceleration", () => {
    expect(presetRate({ maxAccel: 400 }, "standard")).toBeNull();
  });
});

describe("ramp presets", () => {
  it("recognises the configured acceleration as 标准 at both ends", () => {
    expect(matchingRampPreset(axis(), "accel", limits)).toBe("standard");
    expect(matchingRampPreset(axis(), "decel", limits)).toBe("standard");
  });

  it("sets both ramps to one preset without changing the duration", () => {
    const next = withRampPreset(axis(), "quick");
    expect(next).toEqual(trap(500, 500));
    // 变速时间取整到 0.1 s，变化率只会差一点，而且不超过这一档
    const rates = trapezoidRatesOf(next!, 400, 5000);
    expect(rates?.acceleration).toBeLessThanOrEqual(200);
    expect(rates?.deceleration).toBeLessThanOrEqual(200);
    expect(rampPresetOf(axis(next!))).toBe("quick");
  });

  it("refuses a preset too gentle for the time", () => {
    expect(withRampPreset(axis(), "soft")).toBeNull();
  });

  it("reads one preset only when both ends are on it", () => {
    expect(rampPresetOf(axis())).toBe("standard");
    expect(rampPresetOf(axis(trap(2600, 1300)))).toBeNull();
  });

  it("ignores an end that keeps its speed (no ramp needed there)", () => {
    // 终点接着下一段、经过速度 100 和匀速（约 99）差不多：收尾按哪一档都用不到 0.1 s，只看起步
    const flowing = axis(trap(1000, 100), { durationMs: 4550, boundary: { startSpeed: 0, endSpeed: 100 } });
    expect(rampPresetOf(flowing)).toBe("standard");
  });

  it("calls a hand-tuned ramp 自定义", () => {
    expect(matchingRampPreset(axis(trap(1700, 1000)), "accel", limits)).toBeNull();
  });
});

describe("referencePlan", () => {
  it("times the segment at the default speed with 标准 ramps", () => {
    const plan = referencePlan([axis()], "default");
    expect(plan?.durationMs).toBe(5000);
    expect(plan?.profiles.get("v1")).toEqual(trap(1000, 1000));
  });

  it("times the fastest run at 95% of the speed limit with 快 ramps", () => {
    // 400 mm 到不了 380 mm/s：按 200 mm/s² 加速到顶就减速，约 2.83 s，取到 2.9 s
    const plan = referencePlan([axis()], "fastest");
    expect(plan?.durationMs).toBe(2900);
    const profile = plan?.profiles.get("v1");
    expect(profile?.kind).toBe("trapezoid");
    const rates = profile ? trapezoidRatesOf(profile, 400, 2900) : null;
    expect(rates?.acceleration).toBeLessThanOrEqual(200);
    expect(rates?.cruiseSpeed).toBeLessThanOrEqual(380);
  });

  it("takes the slowest axis and fits the others into the same time", () => {
    const plan = referencePlan(
      [axis(), { ...axis(), axis: "v2" as const, distance: 100 }],
      "default",
    );
    expect(plan?.durationMs).toBe(5000);
    expect(plan?.profiles.size).toBe(2);
  });

  it("has nothing to offer without configured speeds", () => {
    expect(referencePlan([axis(trap(1000, 1000), { limits: { defaultAccel: 100 } })], "default")).toBeNull();
    expect(referencePlan([axis(trap(1000, 1000), { distance: 0 })], "default")).toBeNull();
  });
});

describe("profileForDuration", () => {
  it("keeps 标准 ramps 标准 when the segment gets longer", () => {
    expect(profileForDuration(axis(), 6000)).toEqual(trap(800, 800));
  });

  it("keeps hand-tuned ramp times, shrinking them only when they no longer fit", () => {
    const custom = axis(trap(1500, 500), { limits: {} });
    expect(profileForDuration(custom, 6000)).toEqual(trap(1500, 500));
    expect(profileForDuration(custom, 2000)).toEqual(trap(1400, 400));
  });
});
