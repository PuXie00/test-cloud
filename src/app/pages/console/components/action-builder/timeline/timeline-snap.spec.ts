import { describe, expect, it } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { nextKeyframeMs, keyframeTimesMs, previousKeyframeMs } from "./timeline-keyframes";
import { snapSpanStart, snapTargetTimes, snapToTargets } from "./timeline-snap";
import { fitAllPxPerSecond, revealCursorViewStart } from "./timeline-view-extent";

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: false,
  blocks: [
    { id: "a", kind: "pose", objectId: 7, atMs: 1200, pose: { v1: 0 } },
    { id: "b", kind: "pose", objectId: 8, atMs: 3400, pose: { v1: 0 } },
    { id: "on", kind: "instruction", presetId: "set-enabled", objectId: 8, atMs: 500, instr: { enabled: true } },
    {
      id: "wave",
      kind: "dynamic-preset",
      presetId: "dynamic-wave",
      orderedObjectIds: [9, 10],
      startMs: 6000,
      endMs: 9000,
      params: {},
      profiles: {
        v1: { kind: "idle" },
        v2: { kind: "idle" },
        v3: { kind: "idle" },
      },
    },
  ],
  segments: [],
};

describe("snap targets", () => {
  it("collects sequence ends, the playhead and other rows' block times", () => {
    expect(snapTargetTimes({ sequence, totalMs: 9000, cursorMs: 2000 })).toEqual([
      0, 500, 1200, 2000, 3400, 6000, 9000,
    ]);
    // 拖物体 8 的块时不吸自己这一行
    expect(snapTargetTimes({ sequence, totalMs: 9000, excludeObjectIds: new Set([8]) })).toEqual([
      0, 1200, 6000, 9000,
    ]);
  });

  it("snaps within 8 px of a target and 4 px of a whole second", () => {
    const targets = [0, 1200, 3400];
    // 20 px/s：8 px = 400 ms，4 px = 200 ms
    expect(snapToTargets(1500, targets, 20)).toEqual({ ms: 1200, snappedTo: 1200 });
    expect(snapToTargets(1700, targets, 20)).toEqual({ ms: 1700, snappedTo: null });
    expect(snapToTargets(2150, targets, 20)).toEqual({ ms: 2000, snappedTo: 2000 });
    expect(snapToTargets(2300, targets, 20)).toEqual({ ms: 2300, snappedTo: null });
    // 放大后同样的时间差就不吸了
    expect(snapToTargets(1500, targets, 100)).toEqual({ ms: 1500, snappedTo: null });
  });

  it("snaps a moved span by whichever end is closer", () => {
    // 起点 1100 离 1200 差 100，终点 3300 离 3400 差 100 → 起点优先
    expect(snapSpanStart(1100, 2200, [1200, 3400], 20)).toEqual({ ms: 1200, snappedTo: 1200 });
    expect(snapSpanStart(1250, 2200, [1600, 3400], 20)).toEqual({ ms: 1200, snappedTo: 3400 });
    // 终点正好在整秒上也算吸住
    expect(snapSpanStart(1700, 1300, [], 20)).toEqual({ ms: 1700, snappedTo: 3000 });
    expect(snapSpanStart(1700, 1350, [], 100)).toEqual({ ms: 1700, snappedTo: null });
  });
});

describe("keyframes", () => {
  it("uses the focused objects when the sequence has them, else the whole sequence", () => {
    expect(keyframeTimesMs(sequence, 9000)).toEqual([0, 500, 1200, 3400, 6000, 9000]);
    expect(keyframeTimesMs(sequence, 9000, [8])).toEqual([0, 500, 3400, 9000]);
    expect(keyframeTimesMs(sequence, 9000, [99])).toEqual([0, 500, 1200, 3400, 6000, 9000]);
  });

  it("finds the previous and next keyframe strictly around the playhead", () => {
    const times = [0, 500, 3400, 9000];
    expect(previousKeyframeMs(times, 3400)).toBe(500);
    expect(nextKeyframeMs(times, 3400)).toBe(9000);
    expect(previousKeyframeMs(times, 0)).toBeNull();
    expect(nextKeyframeMs(times, 9000)).toBeNull();
  });
});

describe("view helpers", () => {
  it("fits the whole sequence with a margin, within the zoom limits", () => {
    // 时间区 808 - 8 = 800 px，10 s × 1.05
    expect(fitAllPxPerSecond(10_000, 808)).toBeCloseTo(800 / 10.5);
    expect(fitAllPxPerSecond(0, 808)).toBe(16);
    expect(fitAllPxPerSecond(1_000_000, 808)).toBe(2);
    expect(fitAllPxPerSecond(100, 808)).toBe(200);
  });

  it("centers the playhead only when it left the view", () => {
    expect(revealCursorViewStart({ cursorMs: 3000, viewStartMs: 0, viewportMs: 10_000 })).toBe(0);
    expect(revealCursorViewStart({ cursorMs: 30_000, viewStartMs: 0, viewportMs: 10_000 })).toBe(25_000);
    expect(revealCursorViewStart({ cursorMs: 1000, viewStartMs: 8000, viewportMs: 10_000 })).toBe(0);
  });
});
