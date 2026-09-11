import { describe, expect, it } from "vitest";
import { createDefaultAxisProfiles } from "./motion-profile";
import { sequenceObjectIds } from "./sequence-object-ids";
import type { ActionSequenceConfig } from "./types";

const sequenceOf = (blocks: ActionSequenceConfig["blocks"]): ActionSequenceConfig => ({
  id: 1,
  name: "Seq",
  trajectoryMode: "forced",
  blocks,
  segments: [],
});

describe("sequenceObjectIds", () => {
  it("collects pose and set-enabled objectIds", () => {
    const ids = sequenceObjectIds(
      sequenceOf([
        { id: "p", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 0, v2: 0, v3: 0 } },
        { id: "e", kind: "instruction",
      presetId: "set-enabled", objectId: 2, atMs: 0, instr: { enabled: true } },
      ]),
    );
    expect([...ids].sort()).toEqual([1, 2]);
  });

  it("collects preset orderedObjectIds and dedupes", () => {
    const ids = sequenceObjectIds(
      sequenceOf([
        { id: "p", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 0, v2: 0, v3: 0 } },
        { id: "s", kind: "static-preset", presetId: "static-flat", orderedObjectIds: [1, 3], params: {}, atMs: 0 },
        {
          id: "d",
          kind: "dynamic-preset",
          presetId: "dynamic-wave",
          orderedObjectIds: [4],
          params: {},
          startMs: 0,
          endMs: 1000,
          profiles: createDefaultAxisProfiles(1000),
        },
      ]),
    );
    expect([...ids].sort()).toEqual([1, 3, 4]);
  });

  it("returns empty set for empty sequence", () => {
    expect(sequenceObjectIds(sequenceOf([])).size).toBe(0);
  });
});
