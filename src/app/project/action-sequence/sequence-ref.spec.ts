import { describe, expect, it } from "vitest";
import { resolveActionSequence } from "./resolve-sequence";
import {
  buildSequenceRefBlock,
  refreshSequenceRefs,
  sequencesReferencing,
  wouldCreateRefCycle,
} from "./sequence-ref";
import type { ActionSequenceConfig, MotionSegmentConfig, PoseBlock, TimelineBlock } from "./types";
import { validateActionSequence } from "./validate-sequence";

const pose = (id: string, objectId: number, atMs: number, v1: number): PoseBlock => ({
  id,
  kind: "pose",
  objectId,
  atMs,
  pose: { v1 },
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

const sequenceOf = (
  id: number,
  name: string,
  blocks: TimelineBlock[],
  segments: MotionSegmentConfig[] = [],
): ActionSequenceConfig => ({ id, name, trajectoryMode: false, blocks, segments });

// 源序列：物体 1 两秒从 100 走到 300，加减速各 0.5 s
const source = sequenceOf(2, "抬起", [pose("s0", 1, 0, 100), pose("s1", 1, 2000, 300)], [ramp("s0", "s1", 500, 500)]);

const parentWith = (ref: TimelineBlock): ActionSequenceConfig =>
  sequenceOf(1, "主序列", [pose("p0", 1, 0, 0), ref]);

describe("sequence references", () => {
  it("plays the referenced sequence from its start time, as one block", () => {
    const ref = buildSequenceRefBlock(source, { id: "ref", atMs: 3000 });
    expect(ref).toMatchObject({ sequenceId: 2, durationMs: 2000, orderedObjectIds: [1] });
    const resolved = resolveActionSequence(parentWith(ref));
    expect(resolved.totalMs).toBe(5000);
    const points = resolved.posesByObject.get(1)!;
    expect(points.map((point) => [point.atMs, point.pose.v1, point.sourceBlockId, point.sourceKind])).toEqual([
      [0, 0, "p0", "pose"],
      [3000, 100, "ref", "sequence-ref"],
      [5000, 300, "ref", "sequence-ref"],
    ]);
    expect(points[1]?.editable).toBe(false);
    // 进到引用前的那段可以改；引用里面的跟着源序列，不能单独改，曲线照搬
    const [into, inside] = resolved.segments;
    expect(into?.configurable).toBe(true);
    expect(inside).toMatchObject({ configurable: false, ownerPresetBlockId: "ref" });
    expect(inside?.settings.profiles.v1).toEqual({ kind: "trapezoid", params: { accelMs: 500, decelMs: 500 } });
    // 和单独播放一样从静止起步：前面那段接过来也停在开头
    expect(points[1]?.junctions?.v1?.speed).toBe(0);
  });

  it("belongs the points of a nested reference to the outer reference block", () => {
    const middle = sequenceOf(3, "中间", [buildSequenceRefBlock(source, { id: "inner", atMs: 0 })]);
    const outer = buildSequenceRefBlock(middle, { id: "outer", atMs: 1000 });
    expect(outer.durationMs).toBe(2000);
    const resolved = resolveActionSequence(sequenceOf(1, "主序列", [outer]));
    expect(resolved.poses.map((point) => [point.atMs, point.sourceBlockId])).toEqual([
      [1000, "outer"],
      [3000, "outer"],
    ]);
  });

  it("follows the source when it is saved again", () => {
    const parent = parentWith(buildSequenceRefBlock(source, { id: "ref", atMs: 3000 }));
    const untouched = sequenceOf(9, "别的", [pose("x", 1, 0, 0)]);
    const longer = { ...source, blocks: [...source.blocks, pose("s2", 1, 4000, 0)] };
    const library = new Map([longer, parent, untouched].map((item) => [item.id, item]));
    const [refreshed, same] = refreshSequenceRefs([parent, untouched], library);
    expect(same).toBe(untouched);
    const ref = refreshed?.blocks.find((block) => block.id === "ref");
    expect(ref?.kind === "sequence-ref" ? [ref.durationMs, ref.content.blocks.length] : null).toEqual([4000, 3]);
    expect(refreshSequenceRefs([refreshed!], library)[0]).toBe(refreshed);
  });

  it("refuses a reference that would loop back", () => {
    const parent = parentWith(buildSequenceRefBlock(source, { id: "ref", atMs: 3000 }));
    const library = new Map([source, parent].map((item) => [item.id, item]));
    expect(wouldCreateRefCycle(source.id, parent, library)).toBe(true);
    expect(wouldCreateRefCycle(source.id, source, library)).toBe(true);
    expect(wouldCreateRefCycle(parent.id, source, library)).toBe(false);
    expect(sequencesReferencing([source, parent], source.id)).toEqual([parent]);
  });

  it("reports a later block that the reference now runs into", () => {
    const ref = buildSequenceRefBlock(source, { id: "ref", atMs: 3000 });
    const crowded = sequenceOf(1, "主序列", [pose("p0", 1, 0, 0), ref, pose("p9", 1, 4000, 0)]);
    const issues = validateActionSequence(crowded, {
      objects: [{ id: 1, enabledVirtualAxes: ["v1"], limits: {} }],
    });
    expect(issues.some((issue) => issue.code === "motion-overlap" && issue.objectId === 1)).toBe(true);
  });
});
