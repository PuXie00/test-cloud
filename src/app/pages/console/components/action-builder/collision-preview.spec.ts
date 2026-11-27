import { describe, expect, it } from "vitest";
import { indexCollisionTimes, collisionIdsAt, collisionPreviewPoses, captureCollisionBasePoses } from "./collision-preview";

describe("collision inspection", () => {
  it("looks up simultaneous contacts including static scenery without marking uncertain intervals", () => {
    const index = indexCollisionTimes([
      { objectIds: [1, 2], startMs: 123.5, endMs: 210, kind: "collision" },
      { objectIds: [2, 3], startMs: 150, endMs: 220, kind: "collision" },
      { objectIds: [3, 4], startMs: 120, endMs: 220, kind: "review" },
    ]);
    expect(collisionIdsAt(index, 123)).toEqual([]);
    expect(collisionIdsAt(index, 123.5)).toEqual([1, 2]);
    expect(collisionIdsAt(index, 210)).toEqual([1, 2, 3]);
    expect(collisionIdsAt(index, 211)).toEqual([2, 3]);
  });

  it("replays captured uncontrolled axes and other objects without overwriting authored axes", () => {
    const base = new Map([[2, { v1: 88, v3: 20 }], [6, { v1: 32 }]]);
    const animated = new Map([[2, { v1: 75, v2: 2, v3: 0 }]]);
    expect(collisionPreviewPoses(animated, new Map([[2, ["v3"]]]), base)).toEqual(new Map([
      [2, { v1: 75, v2: 2, v3: 20 }], [6, { v1: 32, v2: 0, v3: 0 }],
    ]));
  });

  it("keeps absent and offline telemetry unknown to the scanner", () => {
    expect(captureCollisionBasePoses([
      { descriptor: { id: 1 }, live: true, positions: { h: 0, p: NaN } },
      { descriptor: { id: 2 }, live: false, positions: { h: 45 } },
      { descriptor: { id: 3 }, live: true, positions: null },
    ])).toEqual(new Map([[1, { v1: 0 }]]));
  });
});
