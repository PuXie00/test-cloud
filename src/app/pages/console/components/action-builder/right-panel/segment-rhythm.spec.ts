import { describe, expect, it } from "vitest";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig, PoseBlock } from "@/app/project/action-sequence/types";
import { mergeSegments, staggerSegments } from "./segment-rhythm";

const pose = (id: string, objectId: number, atMs: number, v1: number): PoseBlock => ({
  id,
  kind: "pose",
  objectId,
  atMs,
  pose: { v1 },
});

const object = (id: number) => ({
  id,
  name: `升降-${id}`,
  currentPosition: 0,
  unit: "mm",
  axisLabel: "",
  enabled: true,
  enabledAxes: ["v1" as const],
  maxSpeedByAxis: { v1: 400 },
  minAccelTimeByAxis: { v1: 1 },
  defaultSpeedByAxis: { v1: 100 },
  defaultAccelByAxis: { v1: 100 },
});

const keysOf = (sequence: ActionSequenceConfig) => resolveActionSequence(sequence).segments.map((s) => s.key);
const timeOf = (sequence: ActionSequenceConfig, id: string) =>
  (sequence.blocks.find((block) => block.id === id) as PoseBlock | undefined)?.atMs;

describe("staggerSegments", () => {
  // 三台同时 0 s 出发、4 s 到
  const three: ActionSequenceConfig = {
    id: 1,
    name: "three",
    trajectoryMode: false,
    blocks: [
      pose("a1", 1, 0, 0),
      pose("b1", 1, 4000, 400),
      pose("a2", 2, 0, 0),
      pose("b2", 2, 4000, 400),
      pose("a3", 3, 0, 0),
      pose("b3", 3, 4000, 400),
    ],
    segments: [],
  };

  it("keeps the arrivals and pushes each later start back by the gap", () => {
    const result = staggerSegments(three, keysOf(three), 1000, object);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(["a1", "a2", "a3", "b1", "b2", "b3"].map((id) => timeOf(result.sequence, id))).toEqual([
      0, 1000, 2000, 4000, 4000, 4000,
    ]);
  });

  it("refuses a gap the last segment cannot fit", () => {
    expect(staggerSegments(three, keysOf(three), 2000, object)).toEqual({
      ok: false,
      message: "间隔太大：升降-3 那段排不下",
    });
  });
});

describe("mergeSegments", () => {
  // 升降-1 从 0、升降-2 从 600 一起出发，10 s 都到 3000
  const pair: ActionSequenceConfig = {
    id: 2,
    name: "pair",
    trajectoryMode: false,
    blocks: [pose("a1", 1, 0, 0), pose("b1", 1, 10000, 3000), pose("a2", 2, 0, 600), pose("b2", 2, 10000, 3000)],
    segments: [],
  };

  it("adds matching merge poses with the side-by-side speed and moves nothing else", () => {
    const result = mergeSegments(pair, keysOf(pair), object);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const merges = result.sequence.blocks.filter(
      (block): block is PoseBlock => block.kind === "pose" && (block.passSpeeds?.v1 ?? 0) > 0,
    );
    expect(merges).toHaveLength(2);
    expect(merges[0]!.atMs).toBe(merges[1]!.atMs);
    expect(merges[0]!.pose).toEqual(merges[1]!.pose);
    expect(["a1", "b1", "a2", "b2"].map((id) => timeOf(result.sequence, id))).toEqual([0, 10000, 0, 10000]);
  });

  it("asks to arrive together first", () => {
    const apart: ActionSequenceConfig = {
      ...pair,
      blocks: [pose("a1", 1, 0, 0), pose("b1", 1, 9000, 3000), pose("a2", 2, 0, 600), pose("b2", 2, 10000, 3000)],
    };
    expect(mergeSegments(apart, keysOf(apart), object)).toEqual({
      ok: false,
      message: "两段要同时到达：先用「同时到达」对齐",
    });
  });
});
