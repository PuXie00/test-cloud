import { describe, expect, it } from "vitest";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import type { ResolvedMotionSegment } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { validateActionSequence } from "@/app/project/action-sequence/validate-sequence";
import type { Vec3 } from "./multi-point-forward";
import {
  collectMotorOverspeedHits,
  formatMotorOverspeedMessage,
  type MotorOverspeedObject,
} from "./motor-overspeed";

const SQUARE: Vec3[] = [
  [100, 100, 0],
  [-100, 100, 0],
  [-100, -100, 0],
  [100, -100, 0],
];

const objectOf = (limit: number): MotorOverspeedObject => ({
  objectId: 7,
  pointInitPos: SQUARE,
  baseHeight1: 80,
  baseHeight2: 0,
  maxHeight: 800,
  betaInit: 0,
  motors: SQUARE.map((_, index) => ({
    id: index + 1,
    name: `吊点${index + 1}`,
    maxAxisVelocity: limit,
  })),
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

describe("collectMotorOverspeedHits", () => {
  it("passes when all hoist rope speeds stay under the motor limit", () => {
    const hits = collectMotorOverspeedHits(
      [objectOf(400)],
      [segmentOf({ v1: 0, v2: 0, v3: 0 }, { v1: 200, v2: 0, v3: 0 }, 2000)],
    );
    expect(hits).toEqual([]);
  });

  it("keeps only the highest peak-velocity hit for a segment", () => {
    const hits = collectMotorOverspeedHits(
      [objectOf(220)],
      [segmentOf({ v1: 0, v2: 0, v3: 0 }, { v1: 200, v2: 12, v3: 10 }, 1000)],
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.peakVelocity).toBeGreaterThan(220);
    expect(hits[0]?.suggestedDurationMs).toBeGreaterThan(1000);
    expect(hits[0]?.message).toContain("处线速度达到");
    expect(hits[0]?.message).toContain("超过电机限速");
  });

  it("recommends stretching duration by the overspeed ratio", () => {
    const message = formatMotorOverspeedMessage({
      atMs: 1240,
      peakVelocity: 560,
      limitVelocity: 500,
      suggestedDurationMs: 3360,
    });
    expect(message).toBe(
      "在 t = 1.24s 处线速度达到 560 mm/s，超过电机限速 500 mm/s。建议将本段时长延长至 3.36s",
    );
  });
});

describe("validateActionSequence motor-overspeed", () => {
  const axis = (maxVelocity: number) => ({
    min: -800,
    max: 800,
    maxVelocity,
  });

  const sequence: ActionSequenceConfig = {
    id: 1,
    name: "multi",
    trajectoryMode: true,
    blocks: [
      { id: "p0", kind: "pose", objectId: 7, atMs: 0, pose: { v1: 0, v2: 0, v3: 0 } },
      { id: "p1", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 200, v2: 12, v3: 10 } },
    ],
    segments: [],
  };

  it("blocks download-path validation when hoist motors overspeed", () => {
    const issues = validateActionSequence(sequence, {
      objects: [
        {
          id: 7,
          enabledVirtualAxes: ["v1", "v2", "v3"],
          limits: { v1: axis(500), v2: axis(30), v3: axis(30) },
        },
      ],
      hoistObjects: [objectOf(220)],
    });
    expect(issues.some((issue) => issue.code === "motor-overspeed")).toBe(true);
  });
});
