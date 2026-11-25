import { describe, expect, it } from "vitest";
import type { ResolvedActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ModelPose } from "@/app/project/action-sequence/types";
import {
  buildMotionPathEntries,
  motionPathObjectIds,
  motionPathSampleStepMs,
  posesAtSafe,
  sampleMotionPaths,
  type MotionPathBuildInput,
} from "./motion-path-entries";

const pose = (v1: number): ModelPose => ({ v1, v2: 0, v3: 0 });

const point = (objectId: number, atMs: number, v1: number, blockId: string | null, visible = true) => ({
  objectId,
  atMs,
  pose: pose(v1),
  sourceBlockId: blockId,
  visible,
});

const resolved = {
  posesByObject: new Map([
    [1, [point(1, 0, 0, null, false), point(1, 1000, 0, "a1"), point(1, 3000, 500, "a2"), point(1, 5000, 0, "a3")]],
    [2, [point(2, 1000, 0, "b1"), point(2, 4000, 800, "b2")]],
  ]),
  segments: [
    { key: "s-a1-a2", objectId: 1, startMs: 1000, endMs: 3000 },
    { key: "s-a2-a3", objectId: 1, startMs: 3000, endMs: 5000 },
    { key: "s-b1-b2", objectId: 2, startMs: 1000, endMs: 4000 },
  ],
} as unknown as Pick<ResolvedActionSequence, "posesByObject" | "segments">;

const input = (overrides: Partial<MotionPathBuildInput> = {}): MotionPathBuildInput => ({
  resolved,
  samples: new Map([
    [1, [0, 1000, 2000, 3000, 4000, 5000].map((atMs) => ({ atMs, pose: pose(atMs / 10) }))],
    [2, [1000, 4000].map((atMs) => ({ atMs, pose: pose(atMs / 5) }))],
  ]),
  cursorPoses: new Map([
    [1, pose(200)],
    [2, pose(300)],
  ]),
  cursorMs: 2000,
  objectIds: [1],
  selectedObjectIds: new Set([1]),
  selectedBlockIds: new Set(["a2"]),
  invalid: { blockIds: new Set(["a3"]), segmentKeys: new Set<string>() },
  pinnedAxes: () => ({}),
  engineIdOf: (objectId) => `e${objectId}`,
  ...overrides,
});

describe("motionPathSampleStepMs", () => {
  it("keeps 100 ms for short sequences and widens long ones", () => {
    expect(motionPathSampleStepMs(8500)).toBe(100);
    expect(motionPathSampleStepMs(600_000)).toBe(2500);
  });
});

describe("motionPathObjectIds", () => {
  const base = { sequenceObjectIds: [1, 2, 3], selectedObjectIds: [2, 9], selectedBlockObjectIds: [3] };
  it("shows the selected objects and the objects of selected blocks", () => {
    expect(motionPathObjectIds({ ...base, mode: "selected" })).toEqual([2, 3]);
  });
  it("shows everything in the sequence, or nothing", () => {
    expect(motionPathObjectIds({ ...base, mode: "all" })).toEqual([1, 2, 3]);
    expect(motionPathObjectIds({ ...base, mode: "off" })).toEqual([]);
  });
});

describe("buildMotionPathEntries", () => {
  it("draws the selected object's path and its visible poses", () => {
    const [entry] = buildMotionPathEntries(input());
    expect(entry).toMatchObject({ objectId: "e1", selected: true, issueAtCursor: false });
    expect(entry!.samples).toHaveLength(6);
    expect(entry!.keyframes.map((keyframe) => [keyframe.blockId, keyframe.selected, keyframe.invalid])).toEqual([
      ["a1", false, false],
      ["a2", true, false],
      ["a3", false, true],
    ]);
    expect(entry!.cursor).toEqual({ atMs: 2000, values: pose(200) });
    // 不画前后位姿的线框
    expect(entry).not.toHaveProperty("prev");
    expect(entry).not.toHaveProperty("next");
  });

  it("draws unselected objects quietly", () => {
    const [entry] = buildMotionPathEntries(input({ selectedObjectIds: new Set() }));
    expect(entry!.selected).toBe(false);
  });

  it("marks problem segments and flags the object while the cursor is inside one", () => {
    const [entry] = buildMotionPathEntries(
      input({ invalid: { blockIds: new Set(), segmentKeys: new Set(["s-a1-a2"]) } }),
    );
    expect(entry!.issues).toEqual([{ fromMs: 1000, toMs: 3000, segmentKey: "s-a1-a2" }]);
    expect(entry!.issueAtCursor).toBe(true);
  });

  it("outlines other objects in red while the cursor is in their problem segment", () => {
    const entries = buildMotionPathEntries(
      input({ invalid: { blockIds: new Set(), segmentKeys: new Set(["s-b1-b2"]) } }),
    );
    expect(entries.find((entry) => entry.objectId === "e2")).toEqual({
      objectId: "e2",
      selected: false,
      samples: [],
      keyframes: [],
      cursor: { atMs: 2000, values: pose(300) },
      issues: [],
      issueAtCursor: true,
    });
  });

  it("draws axes the sequence doesn't control where the 3D shows them", () => {
    const [entry] = buildMotionPathEntries(input({ pinnedAxes: () => ({ v2: 7 }) }));
    expect(entry!.samples.every((sample) => sample.values.v2 === 7)).toBe(true);
    expect(entry!.cursor?.values.v2).toBe(7);
  });
});

describe("sampleMotionPaths", () => {
  // 1 s 里要加速 5 s、减速 5 s：曲线算不出来（和校验报的问题一样）
  const impossible = {
    posesByObject: new Map([[1, [point(1, 0, 0, "a"), point(1, 1000, 1000, "b")]]]),
    segments: [
      {
        key: "s",
        objectId: 1,
        fromRef: "a",
        toRef: "b",
        startMs: 0,
        endMs: 1000,
        durationMs: 1000,
        fromPose: pose(0),
        toPose: pose(1000),
        configurable: true,
        settings: {
          profiles: {
            v1: { kind: "trapezoid", params: { accelMs: 5000, decelMs: 5000 } },
            v2: { kind: "idle" },
            v3: { kind: "idle" },
          },
        },
      },
    ],
    totalMs: 1000,
  } as unknown as Pick<ResolvedActionSequence, "posesByObject" | "segments" | "totalMs">;

  it("draws a segment it can't evaluate as a straight line instead of failing", () => {
    const samples = sampleMotionPaths(impossible, [1], 250).get(1)!;
    expect(samples.map((sample) => [sample.atMs, sample.pose.v1])).toEqual([
      [0, 0],
      [250, 250],
      [500, 500],
      [750, 750],
      [1000, 1000],
    ]);
    expect(posesAtSafe(impossible, 400).get(1)?.v1).toBeCloseTo(400, 6);
  });
});
