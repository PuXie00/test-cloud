import { describe, expect, it } from "vitest";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import type { ResolvedMotionSegment } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { validateActionSequence } from "@/app/project/action-sequence/validate-sequence";
import {
  collectAngleProtectionHits,
  formatAngleProtectionMessage,
  pitchLimitsAtHeight,
  type AngleProtectionObject,
} from "./angle-protection";

const LIMITS = {
  minHeight: 0,
  maxHeight: 1000,
  radius: 200,
  minPitch: -20,
  maxPitch: 20,
};

const objectOf = (radius = 200): AngleProtectionObject => ({
  objectId: 7,
  ...LIMITS,
  radius,
});

const segmentOf = (
  from: { v1: number; v2: number; v3: number },
  to: { v1: number; v2: number; v3: number },
  durationMs: number,
): ResolvedMotionSegment => ({
  key: "p0=>p1",
  objectId: 7,
  fromRef: "p0",
  toRef: "p1",
  startMs: 0,
  endMs: durationMs,
  durationMs,
  fromPose: from,
  toPose: to,
  settings: { profiles: createDefaultAxisProfiles(durationMs) },
  configurable: true,
});

describe("pitchLimitsAtHeight", () => {
  it("forbids pitch at min or max height", () => {
    expect(pitchLimitsAtHeight(0, LIMITS)).toEqual({ min: 0, max: 0 });
    expect(pitchLimitsAtHeight(1000, LIMITS)).toEqual({ min: 0, max: 0 });
  });

  it("uses asin(hMin / radius) when remaining stroke is inside the radius", () => {
    const envelope = (Math.asin(50 / 200) * 180) / Math.PI;
    const limits = pitchLimitsAtHeight(50, LIMITS);
    expect(limits.min).toBeCloseTo(-envelope, 10);
    expect(limits.max).toBeCloseTo(envelope, 10);
  });

  it("falls back to software pitch limits when remaining stroke exceeds radius", () => {
    expect(pitchLimitsAtHeight(500, LIMITS)).toEqual({ min: -20, max: 20 });
  });

  it("treats a zero radius as software pitch limits only", () => {
    expect(pitchLimitsAtHeight(0, { ...LIMITS, radius: 0 })).toEqual({ min: -20, max: 20 });
  });

  it("measures remaining top stroke from minHeight", () => {
    const limits = pitchLimitsAtHeight(100, { ...LIMITS, minHeight: 100 });
    expect(limits).toEqual({ min: 0, max: 0 });
  });
});

describe("collectAngleProtectionHits", () => {
  it("flags pitch at min height even when v2 is inside software limits", () => {
    const hits = collectAngleProtectionHits(
      [objectOf()],
      [segmentOf({ v1: 0, v2: 10, v3: 0 }, { v1: 0, v2: 10, v3: 0 }, 1000)],
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.message).toContain("当前高度");
    expect(hits[0]?.message).toContain("虚轴2");
  });

  it("passes lift-only motion", () => {
    expect(
      collectAngleProtectionHits(
        [objectOf()],
        [segmentOf({ v1: 0, v2: 0, v3: 0 }, { v1: 200, v2: 0, v3: 0 }, 2000)],
      ),
    ).toEqual([]);
  });

  it("flags pitch that exceeds the envelope near max height", () => {
    const hits = collectAngleProtectionHits(
      [objectOf()],
      [segmentOf({ v1: 990, v2: 10, v3: 0 }, { v1: 990, v2: 10, v3: 0 }, 1000)],
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it("ignores yaw-only poses", () => {
    expect(
      collectAngleProtectionHits(
        [objectOf()],
        [segmentOf({ v1: 200, v2: 0, v3: 15 }, { v1: 200, v2: 0, v3: 15 }, 1000)],
      ),
    ).toEqual([]);
  });

  it("catches a mid-segment violation while height drops with pitch held", () => {
    const hits = collectAngleProtectionHits(
      [objectOf()],
      [segmentOf({ v1: 500, v2: 18, v3: 0 }, { v1: 0, v2: 18, v3: 0 }, 2000)],
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.segmentKey).toBe("p0=>p1");
  });

  it("skips objects without a positive radius", () => {
    expect(
      collectAngleProtectionHits(
        [objectOf(0)],
        [segmentOf({ v1: 0, v2: 10, v3: 0 }, { v1: 0, v2: 10, v3: 0 }, 1000)],
      ),
    ).toEqual([]);
  });
});

describe("formatAngleProtectionMessage", () => {
  it("names height, allowed pitch, and actual pitch", () => {
    expect(
      formatAngleProtectionMessage({
        height: 50,
        pitch: 18,
        limitMin: -14.5,
        limitMax: 14.5,
      }),
    ).toBe("当前高度 50 mm 下虚轴2 允许 [-14.5, 14.5]°，实际 18°");
  });
});

describe("validateActionSequence angle-protection", () => {
  const axis = (min: number, max: number) => ({
    min,
    max,
    maxVelocity: 10_000,
    minAccelTime: 0.01,
  });

  const sequenceOf = (pose: { v1: number; v2: number; v3: number }): ActionSequenceConfig => ({
    id: 1,
    name: "angle",
    trajectoryMode: "forced",
    blocks: [{ id: "p0", kind: "pose", objectId: 7, atMs: 0, pose }],
    segments: [],
  });

  it("blocks validation when a static pose violates the envelope", () => {
    const issues = validateActionSequence(sequenceOf({ v1: 0, v2: 10, v3: 0 }), {
      objects: [
        {
          id: 7,
          enabledVirtualAxes: ["v1", "v2", "v3"],
          limits: { v1: axis(0, 1000), v2: axis(-20, 20), v3: axis(-20, 20) },
          safetyRadius: 200,
        },
      ],
    });
    expect(issues.some((issue) => issue.code === "angle-protection")).toBe(true);
  });

  it("does not flag a sequence without safetyRadius", () => {
    const issues = validateActionSequence(sequenceOf({ v1: 0, v2: 10, v3: 0 }), {
      objects: [
        {
          id: 7,
          enabledVirtualAxes: ["v1", "v2", "v3"],
          limits: { v1: axis(0, 1000), v2: axis(-20, 20), v3: axis(-20, 20) },
        },
      ],
    });
    expect(issues.some((issue) => issue.code === "angle-protection")).toBe(false);
  });
});
