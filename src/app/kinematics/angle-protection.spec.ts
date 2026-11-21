import { describe, expect, it } from "vitest";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import type { ResolvedMotionSegment } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { validateActionSequence } from "@/app/project/action-sequence/validate-sequence";
import {
  collectAngleProtectionHits,
  combinedTiltDeg,
  formatAngleProtectionMessage,
  formatXyTiltProtectionMessage,
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

describe("collectAngleProtectionHits XY tilt", () => {
  // 高度 42 时上限 asin(42/200) ≈ 12.1°；X、Y 各 10° 合成约 14.1°
  const xyObject: AngleProtectionObject = { ...objectOf(), xyTilt: true };
  const tiltedPose = { v1: 42, v2: 10, v3: 10 };

  it("limits the combined X/Y tilt instead of v2 alone", () => {
    const hits = collectAngleProtectionHits(
      [xyObject],
      [segmentOf(tiltedPose, tiltedPose, 1000)],
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain("合成倾角");
    const envelopeDeg = (Math.asin(42 / 200) * 180) / Math.PI;
    expect(hits[0]?.excess).toBeCloseTo(combinedTiltDeg(10, 10) - envelopeDeg, 6);
  });

  it("lets the same pose pass the single-pitch check", () => {
    expect(
      collectAngleProtectionHits([objectOf()], [segmentOf(tiltedPose, tiltedPose, 1000)]),
    ).toEqual([]);
  });

  it("passes when the combined tilt stays inside the envelope", () => {
    const pose = { v1: 42, v2: 10, v3: 0 };
    expect(collectAngleProtectionHits([xyObject], [segmentOf(pose, pose, 1000)])).toEqual([]);
  });

  it("flags Y-only tilt at min height", () => {
    const pose = { v1: 0, v2: 0, v3: 5 };
    expect(collectAngleProtectionHits([xyObject], [segmentOf(pose, pose, 1000)])).toHaveLength(1);
  });
});

describe("combinedTiltDeg", () => {
  it("reduces to the single angle when the other is zero", () => {
    expect(combinedTiltDeg(12, 0)).toBeCloseTo(12, 10);
    expect(combinedTiltDeg(0, -12)).toBeCloseTo(12, 10);
  });

  it("is larger than either angle when both tilt", () => {
    expect(combinedTiltDeg(10, 10)).toBeCloseTo(14.106, 3);
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

  it("names the combined X/Y tilt for XY tilt objects", () => {
    expect(
      formatXyTiltProtectionMessage({
        height: 42,
        angleX: 10,
        angleY: 10,
        combined: 14.106,
        limit: 12.12,
      }),
    ).toBe("当前高度 42 mm 下虚轴2、虚轴3 合成倾角最大 12.1°，实际 14.1°（虚轴2 10°，虚轴3 10°）");
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
    trajectoryMode: true,
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

  it("keeps a loop sequence inside the envelope at its bottom seam", () => {
    // 循环首尾在最低点：v1 折返从静止起步，v2 若带速度穿过 0 会冲出包络；循环首尾一律停下
    const pose = (id: string, atMs: number, v1: number, v2: number) =>
      ({ id, kind: "pose", objectId: 7, atMs, pose: { v1, v2 } }) as const;
    const loop: ActionSequenceConfig = {
      id: 0,
      name: "loop",
      trajectoryMode: true,
      loop: true,
      blocks: [pose("p0", 0, 0, 0), pose("p1", 10_000, 4000, 10), pose("p2", 20_000, 3000, -10), pose("p3", 30_000, 0, 0)],
      segments: [],
    };
    const issues = validateActionSequence(loop, {
      objects: [
        {
          id: 7,
          enabledVirtualAxes: ["v1", "v2", "v3"],
          limits: { v1: axis(0, 5000), v2: axis(-30, 30), v3: axis(-30, 30) },
          safetyRadius: 1000,
        },
      ],
    });
    expect(issues.filter((issue) => issue.code === "angle-protection")).toEqual([]);
  });

  it("blocks validation when an XY tilt object exceeds the combined envelope", () => {
    const issues = validateActionSequence(sequenceOf({ v1: 42, v2: 10, v3: 10 }), {
      objects: [
        {
          id: 7,
          enabledVirtualAxes: ["v1", "v2", "v3"],
          limits: { v1: axis(0, 1000), v2: axis(-20, 20), v3: axis(-20, 20) },
          safetyRadius: 200,
          xyTilt: true,
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
