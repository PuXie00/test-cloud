import { describe, expect, it } from "vitest";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import {
  lookupSequenceSelection,
  pruneSequenceSelection,
  segmentEndpointBlockIds,
  segmentSelection,
  selectedSegmentsOf,
  selectionBlockIds,
  toggleBlockSelection,
  toggleMarkerSelection,
  toggleSegmentSelection,
} from "./sequence-selection";

// 物体 1：p0 → p1 → p2 → 静态预设；物体 2：q0 → 静态预设
const sequence: ActionSequenceConfig = {
  id: 1,
  name: "seq",
  trajectoryMode: false,
  blocks: [
    { id: "p0", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 0 } },
    { id: "p1", kind: "pose", objectId: 1, atMs: 1000, pose: { v1: 100 } },
    { id: "p2", kind: "pose", objectId: 1, atMs: 2000, pose: { v1: 200 } },
    {
      id: "flat",
      kind: "static-preset",
      presetId: "static-flat",
      atMs: 3000,
      orderedObjectIds: [1, 2],
      params: { v1: 50 },
    },
    { id: "q0", kind: "pose", objectId: 2, atMs: 0, pose: { v1: 0 } },
  ],
  segments: [],
};
const resolved = resolveActionSequence(sequence);
const segmentFrom = (fromRef: string) => resolved.segments.find((item) => item.fromRef === fromRef)!;
const keys = (blockIds: string[]) => selectedSegmentsOf(resolved, blockIds).map((item) => item.key);

describe("segments follow their end blocks", () => {
  it("maps a segment end to the preset block that produced the key point", () => {
    const toPreset = segmentFrom("p2");
    expect(segmentEndpointBlockIds(resolved, toPreset)).toEqual(["p2", "flat"]);
  });

  it("selects a segment only when both of its end blocks are selected", () => {
    expect(keys(["p0"])).toEqual([]);
    expect(keys(["p0", "p2"])).toEqual([]);
    expect(keys(["p0", "p1", "p2"])).toEqual(["p0->p1", "p1->p2"]);
    expect(keys(["p2", "flat"])).toHaveLength(1);
  });

  it("clicks a segment into its two end blocks", () => {
    expect(segmentSelection(resolved, segmentFrom("p0"))).toEqual({
      kind: "multi-block",
      blockIds: ["p0", "p1"],
      focus: "segments",
    });
  });

  it("looks up the selected blocks together with the segments between them", () => {
    const lookup = lookupSequenceSelection(
      sequence,
      { kind: "multi-block", blockIds: ["p0", "p1", "q0"], focus: "segments" },
      resolved,
    );
    expect(lookup?.kind).toBe("multi-block");
    if (lookup?.kind !== "multi-block") return;
    expect(lookup.blocks.map((block) => block.id)).toEqual(["p0", "p1", "q0"]);
    expect(lookup.segments.map((item) => item.key)).toEqual(["p0->p1"]);
    expect(lookup.focus).toBe("segments");
  });
});

describe("Ctrl/⌘ toggling", () => {
  it("adds or removes a single block", () => {
    expect(toggleBlockSelection({ kind: "block", blockId: "p0" }, "q0")).toEqual({
      kind: "multi-block",
      blockIds: ["p0", "q0"],
    });
    expect(toggleBlockSelection({ kind: "multi-block", blockIds: ["p0", "q0"] }, "p0")).toEqual({
      kind: "block",
      blockId: "q0",
    });
  });

  it("adds both ends of an unselected segment", () => {
    expect(
      toggleSegmentSelection(resolved, { kind: "block", blockId: "q0" }, segmentFrom("p1")),
    ).toEqual({ kind: "multi-block", blockIds: ["q0", "p1", "p2"], focus: "segments" });
  });

  it("keeps the end another selected segment still needs", () => {
    const next = toggleSegmentSelection(
      resolved,
      { kind: "multi-block", blockIds: ["p0", "p1", "p2"] },
      segmentFrom("p0"),
    );
    expect(next).toEqual({ kind: "multi-block", blockIds: ["p1", "p2"], focus: "segments" });
    expect(keys(["p1", "p2"])).toEqual(["p1->p2"]);
  });

  it("drops both ends when the neighbours on each side need them", () => {
    const next = toggleSegmentSelection(
      resolved,
      { kind: "multi-block", blockIds: ["p0", "p1", "p2", "flat"] },
      segmentFrom("p1"),
    );
    expect(next).toEqual({ kind: "multi-block", blockIds: ["p0", "flat"], focus: "segments" });
  });
});

describe("pruning", () => {
  it("keeps the focus while dropping deleted blocks", () => {
    const withoutQ0 = { ...sequence, blocks: sequence.blocks.filter((block) => block.id !== "q0") };
    expect(
      pruneSequenceSelection([withoutQ0], {
        kind: "multi-block",
        blockIds: ["p0", "p1", "q0"],
        focus: "segments",
      }),
    ).toEqual({ kind: "multi-block", blockIds: ["p0", "p1"], focus: "segments" });
  });

  it("returns the same selection when nothing was deleted", () => {
    const selection = { kind: "multi-block" as const, blockIds: ["p0", "p1"] };
    expect(pruneSequenceSelection([sequence], selection)).toBe(selection);
  });
});

describe("marker selection", () => {
  const withMarkers: ActionSequenceConfig = {
    ...sequence,
    markers: [
      { id: "m1", atMs: 500, name: "灯光切换" },
      { id: "m2", atMs: 1500, name: "演员入场" },
    ],
  };

  it("keeps markers apart from blocks", () => {
    expect(selectionBlockIds({ kind: "markers", markerIds: ["m1"] })).toEqual([]);
    expect(toggleMarkerSelection({ kind: "block", blockId: "p0" }, "m1")).toEqual({
      kind: "markers",
      markerIds: ["m1"],
    });
    expect(toggleMarkerSelection({ kind: "markers", markerIds: ["m1", "m2"] }, "m1")).toEqual({
      kind: "markers",
      markerIds: ["m2"],
    });
    expect(toggleMarkerSelection({ kind: "markers", markerIds: ["m1"] }, "m1")).toBeNull();
  });

  it("looks up the selected markers and prunes deleted ones", () => {
    expect(
      lookupSequenceSelection(withMarkers, { kind: "markers", markerIds: ["m2"] }),
    ).toEqual({ kind: "markers", markers: [withMarkers.markers![1]] });
    expect(
      pruneSequenceSelection([sequence], { kind: "markers", markerIds: ["m1"] }),
    ).toBeNull();
    const kept = { kind: "markers" as const, markerIds: ["m1"] };
    expect(pruneSequenceSelection([withMarkers], kept)).toBe(kept);
  });
});
