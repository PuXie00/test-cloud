import { describe, expect, it } from "vitest";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { selectionFromBlockIds } from "../sequence-selection";
import { collectMarqueeBlockIds } from "./timeline-marquee";

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: "non-forced",
  blocks: [
    { id: "first", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 1, v2: 0, v3: 0 } },
    { id: "later", kind: "pose", objectId: 7, atMs: 4000, pose: { v1: 2, v2: 0, v3: 0 } },
    {
      id: "enable",
      kind: "instruction",
      presetId: "set-enabled",
      objectId: 8,
      atMs: 2500,
      instr: { enabled: true },
    },
    {
      id: "dynamic-1",
      kind: "dynamic-preset",
      presetId: "dynamic-level",
      startMs: 5000,
      endMs: 7000,
      orderedObjectIds: [7, 8],
      params: { startV1: 0, targetV1: 100, v2: 0, v3: 0 },
      profiles: createDefaultAxisProfiles(2000),
    },
  ],
  segments: [],
};

describe("timeline marquee hits", () => {
  it("selects point blocks whose hit box intersects the box", () => {
    expect(
      collectMarqueeBlockIds(sequence, [7, 8], { startMs: 1500, endMs: 4200, startRow: 0, endRow: 0 }, 100),
    ).toEqual(["first", "later"]);
  });

  it("selects a dynamic preset when the box overlaps its range on a participant row", () => {
    expect(
      collectMarqueeBlockIds(sequence, [7, 8], { startMs: 6000, endMs: 6500, startRow: 1, endRow: 1 }, 100),
    ).toEqual(["dynamic-1"]);
  });

  it("does not select a command on another row", () => {
    expect(
      collectMarqueeBlockIds(sequence, [7, 8], { startMs: 2400, endMs: 2600, startRow: 0, endRow: 0 }, 100),
    ).toEqual([]);
  });
});

describe("selectionFromBlockIds", () => {
  it("maps 0/1/many hits to null, block, and multi-block", () => {
    expect(selectionFromBlockIds([])).toBeNull();
    expect(selectionFromBlockIds(["first"])).toEqual({ kind: "block", blockId: "first" });
    expect(selectionFromBlockIds(["first", "later"])).toEqual({
      kind: "multi-block",
      blockIds: ["first", "later"],
    });
  });
});
