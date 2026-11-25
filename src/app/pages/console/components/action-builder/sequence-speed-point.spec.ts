import { describe, expect, it } from "vitest";
import { axisMotionValueAt, axisMotionVelocityAt } from "@/app/project/action-sequence/axis-motion";
import {
  objectAxisMotions,
  resolveActionSequence,
  type ResolvedActionSequence,
} from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  MotionSegmentConfig,
  PoseBlock,
} from "@/app/project/action-sequence/types";
import { insertSpeedPoint, setPassSpeedMode } from "./sequence-ops";

const pose = (id: string, atMs: number, v1: number, extra: Partial<PoseBlock> = {}): PoseBlock => ({
  id,
  kind: "pose",
  objectId: 1,
  atMs,
  pose: { v1 },
  ...extra,
});

const ramp = (fromRef: string, toRef: string, accelMs: number, decelMs: number): MotionSegmentConfig => ({
  fromRef,
  toRef,
  settings: {
    profiles: {
      v1: { kind: "trapezoid", params: { accelMs, decelMs } },
      v2: { kind: "idle" },
      v3: { kind: "idle" },
    },
  },
});

const sequenceOf = (blocks: PoseBlock[], segments: MotionSegmentConfig[]): ActionSequenceConfig => ({
  id: 1,
  name: "Seq",
  trajectoryMode: false,
  blocks,
  segments,
});

const junctionAt = (resolved: ResolvedActionSequence, ref: string) =>
  resolved.poses.find((point) => point.sourceRef === ref)?.junctions?.v1;

const positionAt = (resolved: ResolvedActionSequence, atMs: number): number => {
  const motions = objectAxisMotions(resolved.posesByObject.get(1) ? resolved.segments : [], "v1");
  const motion = motions.find((item) => atMs >= item.startMs && atMs <= item.endMs)!;
  return axisMotionValueAt(motion, atMs);
};

const velocityAt = (resolved: ResolvedActionSequence, atMs: number): number => {
  const motions = objectAxisMotions(resolved.segments, "v1");
  const motion = motions.find((item) => atMs >= item.startMs && atMs < item.endMs)!;
  return axisMotionVelocityAt(motion, atMs);
};

// 0–4 s 走到 400（加减速各 1 s），4–6 s 走到 1000（加减速各 0.5 s），从 0 起步、到 1000 停
const slowFast = (middle: Partial<PoseBlock> = {}) =>
  sequenceOf(
    [pose("p0", 0, 0), pose("p1", 4000, 400, middle), pose("p2", 6000, 1000)],
    [ramp("p0", "p1", 1000, 1000), ramp("p1", "p2", 500, 500)],
  );

describe("pass speed that follows a segment", () => {
  it("follows the incoming segment's cruise so it does not slow down before speeding up", () => {
    const resolved = resolveActionSequence(slowFast({ passSpeedModes: { v1: "prev" } }));
    const junction = junctionAt(resolved, "p1");
    expect(junction?.kind).toBe("follow-prev");
    // 起步从 0：匀速 = 400 / (4 − 0.5)
    expect(junction?.speed).toBeCloseTo(400 / 3.5);
    // 前段最后这 1 s 速度不变
    expect(velocityAt(resolved, 3100)).toBeCloseTo(400 / 3.5);
    expect(velocityAt(resolved, 3900)).toBeCloseTo(400 / 3.5);
  });

  it("follows the outgoing segment's cruise for a slow-down that holds", () => {
    const resolved = resolveActionSequence(slowFast({ passSpeedModes: { v1: "next" } }));
    const junction = junctionAt(resolved, "p1");
    expect(junction?.kind).toBe("follow-next");
    // 到 1000 停：匀速 = 600 / (2 − 0.25)
    expect(junction?.speed).toBeCloseTo(600 / 1.75);
    expect(velocityAt(resolved, 4100)).toBeCloseTo(600 / 1.75);
  });

  it("runs a segment at an even speed when both of its ends follow it", () => {
    const sequence = sequenceOf(
      [
        pose("p0", 0, 0),
        pose("p1", 4000, 400, { passSpeedModes: { v1: "next" } }),
        pose("p2", 6000, 1000, { passSpeedModes: { v1: "prev" } }),
        pose("p3", 8000, 1200),
      ],
      [ramp("p0", "p1", 1000, 1000), ramp("p1", "p2", 500, 500), ramp("p2", "p3", 500, 500)],
    );
    const resolved = resolveActionSequence(sequence);
    expect(junctionAt(resolved, "p1")?.speed).toBeCloseTo(300);
    expect(junctionAt(resolved, "p2")?.speed).toBeCloseTo(300);
  });

  it("still stops where the axis turns back", () => {
    const turnBack = sequenceOf(
      [pose("p0", 0, 0), pose("p1", 4000, 400, { passSpeedModes: { v1: "prev" } }), pose("p2", 6000, 0)],
      [ramp("p0", "p1", 1000, 1000), ramp("p1", "p2", 500, 500)],
    );
    expect(junctionAt(resolveActionSequence(turnBack), "p1")).toEqual({ speed: 0, kind: "reverse" });
  });
});

describe("setPassSpeedMode", () => {
  it("replaces a hand-entered speed with the mode and can go back to automatic", () => {
    const followed = setPassSpeedMode(slowFast({ passSpeeds: { v1: 90 } }), "p1", "v1", "prev");
    if (!followed.ok) throw new Error(followed.reason);
    const p1 = followed.sequence.blocks.find((block) => block.id === "p1") as PoseBlock;
    expect(p1.passSpeedModes).toEqual({ v1: "prev" });
    expect(p1).not.toHaveProperty("passSpeeds");

    const auto = setPassSpeedMode(followed.sequence, "p1", "v1", null);
    if (!auto.ok) throw new Error(auto.reason);
    expect(auto.sequence.blocks.find((block) => block.id === "p1")).not.toHaveProperty("passSpeedModes");
  });

  it("writes the segment curve in the same step", () => {
    const result = setPassSpeedMode(slowFast({ passSpeedModes: { v1: "prev" } }), "p1", "v1", null, {
      fromRef: "p0",
      toRef: "p1",
      axis: "v1",
      profile: { kind: "trapezoid", params: { accelMs: 1000, decelMs: 600 } },
      durationMs: 4000,
    });
    if (!result.ok) throw new Error(result.reason);
    const config = result.sequence.segments.find((item) => item.fromRef === "p0");
    expect(config?.settings.profiles.v1).toEqual({ kind: "trapezoid", params: { accelMs: 1000, decelMs: 600 } });
  });
});

describe("insertSpeedPoint", () => {
  // 10 s 走 1000，加减速各 2 s：匀速 125
  const long = sequenceOf([pose("p0", 0, 0), pose("p1", 10_000, 1000)], [ramp("p0", "p1", 2000, 2000)]);
  const key = "p0->p1";

  it("splits the segment at the playhead without changing the curve", () => {
    const before = resolveActionSequence(long);
    const result = insertSpeedPoint(long, key, 5000);
    if (!result.ok) throw new Error(result.reason);
    const inserted = result.sequence.blocks.find((block) => block.id === result.blockId) as PoseBlock;
    expect(inserted).toMatchObject({ atMs: 5000, pose: { v1: 500 }, passSpeedModes: { v1: "prev" } });
    const after = resolveActionSequence(result.sequence);
    expect(junctionAt(after, result.blockId)).toEqual({ speed: expect.closeTo(125, 6), kind: "follow-prev" });
    for (const atMs of [1000, 3000, 5000, 7000, 9000]) {
      expect(positionAt(after, atMs)).toBeCloseTo(positionAt(before, atMs), 6);
    }
    const profiles = result.sequence.segments.map((config) => [config.fromRef, config.toRef, config.settings.profiles.v1]);
    expect(profiles).toEqual([
      ["p0", result.blockId, { kind: "trapezoid", params: { accelMs: 2000, decelMs: 2000 } }],
      [result.blockId, "p1", { kind: "trapezoid", params: { accelMs: 2000, decelMs: 2000 } }],
    ]);
  });

  it("speeds up the second half from the cruise when it is made faster", () => {
    const result = insertSpeedPoint(long, key, 5000);
    if (!result.ok) throw new Error(result.reason);
    const shorter = {
      ...result.sequence,
      // 后半段 5 s 缩成 4 s（加减速各 2 s 正好排满）
      blocks: result.sequence.blocks.map((block) => (block.id === "p1" ? { ...block, atMs: 9000 } : block)),
    };
    const resolved = resolveActionSequence(shorter);
    // 前半段末尾还是匀速，后半段从 125 往上加
    expect(velocityAt(resolved, 4900)).toBeCloseTo(125);
    expect(velocityAt(resolved, 5500)).toBeGreaterThan(125);
  });

  it("keeps automatic pass speeds at the ends where they were", () => {
    const three = sequenceOf(
      [pose("p0", 0, 0), pose("p1", 10_000, 1000), pose("p2", 12_000, 1300)],
      [ramp("p0", "p1", 2000, 2000), ramp("p1", "p2", 500, 500)],
    );
    const before = junctionAt(resolveActionSequence(three), "p1");
    expect(before?.kind).toBe("auto");
    const result = insertSpeedPoint(three, key, 5000);
    if (!result.ok) throw new Error(result.reason);
    const p1 = result.sequence.blocks.find((block) => block.id === "p1") as PoseBlock;
    expect(p1.passSpeeds?.v1).toBeCloseTo(before!.speed, 1);
  });

  it("needs the playhead in the cruise of the segment", () => {
    expect(insertSpeedPoint(long, key, 1500)).toMatchObject({ ok: false, reason: "not-in-cruise", axis: "v1" });
    expect(insertSpeedPoint(long, key, 9000)).toMatchObject({ ok: false, reason: "not-in-cruise" });
    expect(insertSpeedPoint(long, key, 12_000)).toMatchObject({ ok: false, reason: "outside-segment" });
  });
});
