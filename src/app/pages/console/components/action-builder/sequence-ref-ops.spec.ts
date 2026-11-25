import { describe, expect, it } from "vitest";
import { evaluateResolvedSequence } from "@/app/project/action-sequence/evaluate-sequence";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import { buildSequenceRefBlock } from "@/app/project/action-sequence/sequence-ref";
import type { ActionSequenceConfig, MotionSegmentConfig, PoseBlock, TimelineBlock } from "@/app/project/action-sequence/types";
import { explodeSequenceRefs, insertSequenceRef } from "./sequence-ops";
import type { ControlledObject } from "./timeline/timeline-data";

const pose = (id: string, objectId: number, atMs: number, v1: number): PoseBlock => ({
  id,
  kind: "pose",
  objectId,
  atMs,
  pose: { v1 },
});

const ramp = (fromRef: string, toRef: string): MotionSegmentConfig => ({
  fromRef,
  toRef,
  settings: {
    profiles: {
      v1: { kind: "trapezoid", params: { accelMs: 300, decelMs: 300 } },
      v2: { kind: "idle" },
      v3: { kind: "idle" },
    },
  },
});

const sequenceOf = (id: number, blocks: TimelineBlock[], segments: MotionSegmentConfig[] = []): ActionSequenceConfig => ({
  id,
  name: `序列 ${id}`,
  trajectoryMode: false,
  blocks,
  segments,
});

// 速度上限 1000、加速度上限 2000，默认加速度 1000（最快 = 950 速度、1900 加速度）
const objectOf = (id: number): ControlledObject => ({
  id,
  name: `升降-${id}`,
  currentPosition: 0,
  unit: "mm",
  axisLabel: "H",
  enabled: true,
  enabledAxes: ["v1"],
  maxSpeedByAxis: { v1: 1000 },
  minAccelTimeByAxis: { v1: 0.5 },
  defaultSpeedByAxis: { v1: 500 },
  defaultAccelByAxis: { v1: 1000 },
});

// 被引用：物体 1 一秒从 100 走到 300
const source = sequenceOf(2, [pose("s0", 1, 0, 100), pose("s1", 1, 1000, 300)], [ramp("s0", "s1")]);

describe("explodeSequenceRefs", () => {
  it("turns a reference into ordinary blocks that move the same way", () => {
    const parent = sequenceOf(1, [pose("p0", 1, 0, 0), buildSequenceRefBlock(source, { id: "ref", atMs: 2000 })]);
    const result = explodeSequenceRefs(parent, ["ref"]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.sequence.blocks.map((block) => [block.id, block.kind])).toEqual([
      ["p0", "pose"],
      ["ref~s0", "pose"],
      ["ref~s1", "pose"],
    ]);
    const before = resolveActionSequence(parent);
    const after = resolveActionSequence(result.sequence);
    expect(after.poses.every((point) => point.editable)).toBe(true);
    for (const atMs of [1000, 2300, 2700]) {
      expect(evaluateResolvedSequence(after, atMs).get(1)?.v1).toBeCloseTo(evaluateResolvedSequence(before, atMs).get(1)!.v1);
    }
  });
});

describe("insertSequenceRef", () => {
  it("adds a fastest transition and makes room after the playhead", () => {
    const parent = sequenceOf(1, [
      pose("a0", 1, 0, 0),
      pose("a2", 1, 2000, 500),
      pose("b3", 2, 3000, 0),
    ]);
    parent.markers = [{ id: "m", atMs: 2500, name: "灯" }];
    const result = insertSequenceRef(parent, { source, atMs: 2000, objectOf });
    if (!result.ok) throw new Error(result.reason);
    // 游标处在 500，引用从 100 开始：先按最快走过去
    expect(result.transitionMs).toBeGreaterThan(0);
    const ref = result.sequence.blocks.find((block) => block.id === result.blockId);
    expect(ref?.kind === "sequence-ref" ? ref.atMs : null).toBe(2000 + result.transitionMs);
    expect(result.shiftedMs).toBe(result.transitionMs + 1000);
    // 后面的块、标记往后让
    const later = result.sequence.blocks.find((block) => block.id === "b3") as PoseBlock;
    expect(later.atMs).toBe(3000 + result.shiftedMs);
    expect(result.sequence.markers?.[0]?.atMs).toBe(2500 + result.shiftedMs);
    // 游标处已有位姿，不另加；过渡那段用的是算好的曲线
    expect(result.sequence.blocks.filter((block) => block.kind === "pose" && block.objectId === 1)).toHaveLength(2);
    const transition = result.sequence.segments.find((config) => config.fromRef === "a2");
    expect(transition?.toRef).toBe(`${result.blockId}~s0`);
  });

  it("starts the transition at the playhead with a hold pose", () => {
    const parent = sequenceOf(1, [pose("a0", 1, 0, 500)]);
    const result = insertSequenceRef(parent, { source, atMs: 1500, objectOf });
    if (!result.ok) throw new Error(result.reason);
    const holds = result.sequence.blocks.filter((block) => block.kind === "pose" && block.atMs === 1500);
    expect(holds).toHaveLength(1);
    expect((holds[0] as PoseBlock).pose).toEqual({ v1: 500 });
    expect(result.shiftedMs).toBe(0);
  });

  it("needs no transition when the objects are already where the reference starts", () => {
    const parent = sequenceOf(1, [pose("a0", 1, 0, 100)]);
    const result = insertSequenceRef(parent, { source, atMs: 1000, objectOf });
    if (!result.ok) throw new Error(result.reason);
    expect(result.transitionMs).toBe(0);
    const ref = result.sequence.blocks.find((block) => block.id === result.blockId);
    expect(ref?.kind === "sequence-ref" ? ref.atMs : null).toBe(1000);
  });

  it("does not insert in the middle of another reference", () => {
    const parent = sequenceOf(1, [buildSequenceRefBlock(source, { id: "ref", atMs: 0 })]);
    expect(insertSequenceRef(parent, { source, atMs: 500, objectOf })).toMatchObject({
      ok: false,
      reason: "straddles-block",
      atMs: 0,
    });
  });
});
