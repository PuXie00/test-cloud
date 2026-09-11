import { describe, expect, it } from "vitest";
import { createDefaultAxisProfile } from "@/app/project/action-sequence/motion-profile";
import type { MotionProfile } from "@/app/project/action-sequence/types";
import {
  PROFILE_KIND_OPTIONS,
  profileKindMeta,
} from "./profile-kind";

const trap = (accelMs = 1000, decelMs = 1000): MotionProfile => ({
  kind: "trapezoid",
  params: { accelMs, decelMs },
});

describe("profile kind registry", () => {
  it("lists trapezoid as the only kind option", () => {
    expect(PROFILE_KIND_OPTIONS).toEqual([
      { kind: "trapezoid", label: "梯形" },
    ]);
  });

  it("returns undefined for unknown kinds", () => {
    expect(profileKindMeta("unknown" as MotionProfile["kind"])).toBeUndefined();
  });

  it("returns trapezoid meta with two handles at 20% and 80% for 1000/1000 ms at duration 5000", () => {
    const meta = profileKindMeta("trapezoid");
    expect(meta).toBeDefined();
    expect(meta!.kind).toBe("trapezoid");
    expect(meta!.label).toBe("梯形");

    const profile = trap(1000, 1000);
    expect(meta!.handles(profile, 5000)).toEqual([
      { id: "accel-end", tNorm: 0.2, label: "加速结束" },
      { id: "decel-start", tNorm: 0.8, label: "减速开始" },
    ]);
  });

  it("returns default handles at 20% for createDefaultAxisProfile at duration 5000 with minAccelTime 1s", () => {
    const meta = profileKindMeta("trapezoid")!;
    const profile = createDefaultAxisProfile(5000, 1);
    expect(meta.handles(profile, 5000)).toEqual([
      { id: "accel-end", tNorm: 0.2, label: "加速结束" },
      { id: "decel-start", tNorm: 0.8, label: "减速开始" },
    ]);
  });

  it("delegates applyHandleDrag with durationMs and minAccelMs clamp behavior", () => {
    const meta = profileKindMeta("trapezoid")!;
    const profile = trap(1000, 1000);
    const next = meta.applyHandleDrag(profile, "accel-end", 0.95, 5000, 1000);
    if (next.kind !== "trapezoid") throw new Error("expected trapezoid");
    expect(next.params.accelMs + next.params.decelMs).toBeLessThan(5000);
    expect(next.params.decelMs).toBe(1000);
    expect(next.params.accelMs).toBeGreaterThan(1000);
  });

  it("returns idle meta with no handles and identity drag", () => {
    const meta = profileKindMeta("idle");
    expect(meta?.label).toBe("静止");
    const idle = { kind: "idle" as const };
    expect(meta!.handles(idle, 5000)).toEqual([]);
    expect(meta!.applyHandleDrag(idle, "accel-end", 0.5, 5000)).toEqual(idle);
  });
});
