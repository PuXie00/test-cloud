import { describe, expect, it } from "vitest";
import type { ActionSequenceConfig, PoseBlock, TimelineBlock } from "@/app/project/action-sequence/types";
import { blocksSpanMs, scaleTimelineBlocks } from "./sequence-ops";

const pose = (id: string, objectId: number, atMs: number, v1: number, extra: Partial<PoseBlock> = {}): PoseBlock => ({
  id,
  kind: "pose",
  objectId,
  atMs,
  pose: { v1, v2: 0, v3: 0 },
  ...extra,
});

const trapezoid = (accelMs: number, decelMs: number) =>
  ({ kind: "trapezoid", params: { accelMs, decelMs } }) as const;

const idle = { kind: "idle" } as const;

const sequenceOf = (blocks: TimelineBlock[], extra: Partial<ActionSequenceConfig> = {}): ActionSequenceConfig => ({
  id: 1,
  name: "Seq",
  trajectoryMode: false,
  blocks,
  segments: [],
  ...extra,
});

const timeOf = (sequence: ActionSequenceConfig, id: string): number => {
  const block = sequence.blocks.find((item) => item.id === id);
  if (!block) throw new Error(`missing ${id}`);
  return block.kind === "dynamic-preset" ? block.startMs : block.atMs;
};

describe("scaleTimelineBlocks", () => {
  const staggered = sequenceOf(
    [
      pose("a0", 1, 0, 0),
      pose("a2", 1, 2000, 100, { passSpeeds: { v1: 60 } }),
      pose("a4", 1, 4000, 300),
      pose("a6", 1, 6000, 0),
      pose("b1", 2, 1000, 0),
      pose("b3", 2, 3000, 200),
      pose("b5", 2, 5000, 0),
      pose("c5", 3, 5000, 0),
      pose("c7", 3, 7000, 100),
    ],
    {
      segments: [
        { fromRef: "a0", toRef: "a2", settings: { profiles: { v1: trapezoid(500, 400), v2: idle, v3: idle } } },
        { fromRef: "a4", toRef: "a6", settings: { profiles: { v1: trapezoid(600, 600), v2: idle, v3: idle } } },
      ],
      markers: [
        { id: "m2", atMs: 2000, name: "中间" },
        { id: "m5", atMs: 5000, name: "后面" },
      ],
    },
  );
  const selected = ["a0", "a2", "a4", "b1", "b3"];

  it("stretches from the selection start, keeping the stagger and what follows each object", () => {
    expect(blocksSpanMs(staggered, selected)).toEqual({ startMs: 0, endMs: 4000 });
    const result = scaleTimelineBlocks(staggered, { blockIds: selected, durationMs: 8000 });
    if (!result.ok) throw new Error(result.reason);
    const next = result.sequence;
    expect(result.factor).toBe(2);
    expect(["a0", "a2", "a4", "a6"].map((id) => timeOf(next, id))).toEqual([0, 4000, 8000, 10_000]);
    // B 晚 1 s 出发也跟着等比：2 s 出发，后面那段时长不变
    expect(["b1", "b3", "b5"].map((id) => timeOf(next, id))).toEqual([2000, 6000, 8000]);
    // 没选中的物体、标记不动
    expect(["c5", "c7"].map((id) => timeOf(next, id))).toEqual([5000, 7000]);
    expect(next.markers?.map((marker) => marker.atMs)).toEqual([2000, 5000]);
    // 区内的变速时间同比例，区后的不变；中间位姿手填的经过速度按反比
    const profileOf = (fromRef: string) =>
      next.segments.find((config) => config.fromRef === fromRef)?.settings.profiles.v1;
    expect(profileOf("a0")).toEqual(trapezoid(1000, 800));
    expect(profileOf("a4")).toEqual(trapezoid(600, 600));
    const a2 = next.blocks.find((block) => block.id === "a2");
    expect(a2?.kind === "pose" ? a2.passSpeeds : undefined).toEqual({ v1: 30 });
  });

  it("moves the other objects and markers after the selection too when asked", () => {
    const result = scaleTimelineBlocks(staggered, { blockIds: selected, durationMs: 6000, shiftAll: true });
    if (!result.ok) throw new Error(result.reason);
    expect(["c5", "c7"].map((id) => timeOf(result.sequence, id))).toEqual([7000, 9000]);
    expect(result.sequence.markers?.map((marker) => marker.atMs)).toEqual([3000, 7000]);
  });

  it("refuses when a segment can no longer fit its speed changes", () => {
    const tight = sequenceOf(
      [pose("a0", 1, 0, 0), pose("a2", 1, 200, 50), pose("a4", 1, 2000, 100)],
      {
        segments: [
          { fromRef: "a0", toRef: "a2", settings: { profiles: { v1: trapezoid(100, 100), v2: idle, v3: idle } } },
        ],
      },
    );
    const result = scaleTimelineBlocks(tight, { blockIds: ["a0", "a2", "a4"], durationMs: 1000 });
    expect(result).toMatchObject({ ok: false, reason: "phase-too-short", objectId: 1, atMs: 0 });
  });

  it("refuses when a later start would run into the object's earlier block", () => {
    const crowded = sequenceOf([
      pose("a0", 1, 0, 0),
      pose("a4", 1, 4000, 100),
      pose("b05", 2, 500, 0),
      pose("b1", 2, 1000, 50),
      pose("b3", 2, 3000, 100),
    ]);
    const result = scaleTimelineBlocks(crowded, { blockIds: ["a0", "a4", "b1", "b3"], durationMs: 1000 });
    expect(result).toMatchObject({ ok: false, reason: "crosses-previous", objectId: 2 });
  });

  it("refuses two poses of one object landing on the same 0.1 s", () => {
    const dense = sequenceOf([pose("a0", 1, 0, 0), pose("a1", 1, 100, 10), pose("a2", 1, 200, 20), pose("a9", 1, 900, 90)]);
    const result = scaleTimelineBlocks(dense, { blockIds: ["a0", "a1", "a2", "a9"], durationMs: 300 });
    expect(result).toMatchObject({ ok: false, reason: "time-conflict", objectId: 1 });
  });

  it("needs a selection that spans some time", () => {
    expect(scaleTimelineBlocks(staggered, { blockIds: ["a2"], durationMs: 1000 })).toMatchObject({
      ok: false,
      reason: "nothing-to-scale",
    });
  });
});
