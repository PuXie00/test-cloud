import { describe, expect, it } from "vitest";
import type { TimelineBlock } from "@/app/project/action-sequence/types";
import {
  adjacentPoseTimes,
  focusMotionLabel,
  formatFactor,
  poseBlockIdsAt,
  sequenceMenuTitle,
} from "./sequence-context-menu-model";

const pose = (id: string, objectId: number, atMs: number): TimelineBlock => ({
  id,
  kind: "pose",
  objectId,
  atMs,
  pose: { v1: 0 },
});

const sequence = {
  blocks: [pose("a1", 1, 0), pose("a2", 1, 2000), pose("a3", 1, 6000), pose("b1", 2, 1000), pose("b2", 2, 4000)],
};

describe("adjacentPoseTimes", () => {
  it("finds the nearest poses of these objects on either side of the cursor", () => {
    expect(adjacentPoseTimes(sequence, [1], 2000)).toEqual({ prev: 0, next: 6000 });
    expect(adjacentPoseTimes(sequence, [1, 2], 2500)).toEqual({ prev: 2000, next: 4000 });
  });

  it("has nothing past the ends or for objects without poses", () => {
    expect(adjacentPoseTimes(sequence, [1], 0)).toEqual({ prev: null, next: 2000 });
    expect(adjacentPoseTimes(sequence, [2], 4000)).toEqual({ prev: 1000, next: null });
    expect(adjacentPoseTimes(sequence, [9], 1000)).toEqual({ prev: null, next: null });
  });
});

describe("poseBlockIdsAt", () => {
  it("gives the poses of these objects at that moment", () => {
    expect(poseBlockIdsAt(sequence, [1, 2], 2000)).toEqual(["a2"]);
    expect(poseBlockIdsAt(sequence, [2], 2000)).toEqual([]);
  });
});

describe("menu labels", () => {
  it("names what the menu works on", () => {
    expect(sequenceMenuTitle({ contextName: "吊杆 3", selectedCount: 1 })).toBe("吊杆 3");
    expect(sequenceMenuTitle({ contextName: "吊杆 3", selectedCount: 4 })).toBe("吊杆 3 等 4 台");
    expect(sequenceMenuTitle({ contextName: null, selectedCount: 2 })).toBe("选中的 2 台");
    expect(sequenceMenuTitle({ contextName: null, selectedCount: 0 })).toBe("没有选中物体");
  });

  it("says whose motion gets framed", () => {
    expect(focusMotionLabel(0)).toBe("看全整条动作");
    expect(focusMotionLabel(1)).toBe("看全这台的动作");
    expect(focusMotionLabel(3)).toBe("看全这 3 台的动作");
  });

  it("writes factors with a real minus sign", () => {
    expect(formatFactor(2)).toBe("×2");
    expect(formatFactor(0.5)).toBe("×0.5");
    expect(formatFactor(-1)).toBe("×−1");
  });
});
