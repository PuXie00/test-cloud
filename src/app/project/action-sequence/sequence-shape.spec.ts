import { describe, expect, it } from "vitest";
import { resolveActionSequence } from "./resolve-sequence";
import { sequenceShape } from "./sequence-shape";
import type { ActionSequenceConfig } from "./types";

// 物体 1 从 0 s 开始；物体 2 第一个位姿在 3 s，而且这一帧 V2 经过；物体 2 的 V3 一直不设定
const sequence: ActionSequenceConfig = {
  id: 1,
  name: "shape",
  trajectoryMode: false,
  blocks: [
    { id: "a1", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 100 } },
    { id: "a2", kind: "pose", objectId: 1, atMs: 4000, pose: { v1: 900 } },
    { id: "b1", kind: "pose", objectId: 2, atMs: 3000, pose: { v1: 50 } },
    { id: "b2", kind: "pose", objectId: 2, atMs: 6000, pose: { v1: 70, v2: 20 } },
    { id: "b3", kind: "pose", objectId: 2, atMs: 8000, pose: { v1: 10, v2: 5 } },
  ],
  segments: [],
};

describe("sequenceShape", () => {
  const resolved = resolveActionSequence(sequence);

  it("takes each object's first set values as the start, wherever its first pose is", () => {
    const start = sequenceShape(resolved, "start");
    expect(start.get(1)).toEqual({ v1: 100 });
    // V2 在第一个位姿没设定：取它第一次设定的值
    expect(start.get(2)).toMatchObject({ v1: 50, v2: 20 });
  });

  it("takes each object's last set values as the end", () => {
    const end = sequenceShape(resolved, "end");
    expect(end.get(1)).toEqual({ v1: 900 });
    expect(end.get(2)).toMatchObject({ v1: 10, v2: 5 });
  });

  it("leaves out axes the sequence never sets", () => {
    expect("v3" in sequenceShape(resolved, "start").get(2)!).toBe(false);
    expect("v2" in sequenceShape(resolved, "start").get(1)!).toBe(false);
  });
});
