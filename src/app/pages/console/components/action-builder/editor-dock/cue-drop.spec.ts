import { describe, expect, it } from "vitest";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import type { CueItem } from "../timeline/timeline-data";
import { cueDropPoseForObject } from "../action-builder-ops";

const sequence: ActionSequenceConfig = {
  id: "seq",
  name: "Seq",
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: "pose-1",
      kind: "pose",
      objectId: 7,
      atMs: 1000,
      pose: { v1: 40, v2: 50, v3: 60 },
    },
    {
      id: "dynamic-1",
      kind: "dynamic-preset",
      presetId: "dynamic-level",
      startMs: 2000,
      endMs: 3000,
      orderedObjectIds: [7, 8],
      params: { startV1: 0, targetV1: 100, v2: 0, v3: 0 },
      profiles: createDefaultAxisProfiles(1000),
    },
  ],
  segments: [],
};

const cue: CueItem = {
  id: "cue-1",
  name: "Cue",
  targets: {
    "7": { v1: 11, v3: 33 },
    "9": { v1: 1 },
  },
};

describe("cue drop pose copy", () => {
  it("copies Cue target values and fills missing axes from the previous resolved pose", () => {
    const resolved = resolveActionSequence(sequence);
    const pose = cueDropPoseForObject(cue, 7, 1500, {
      resolved,
      enabledAxes: ["v1", "v2", "v3"],
    });
    expect(pose).toEqual({ v1: 11, v2: 50, v3: 33 });
  });

  it("fills disabled axes from the previous pose even when Cue has a value", () => {
    const resolved = resolveActionSequence({
      ...sequence,
      blocks: sequence.blocks.filter((block) => block.kind === "pose"),
    });
    const pose = cueDropPoseForObject(
      { ...cue, targets: { "7": { v1: 11, v2: 22, v3: 33 } } },
      7,
      1500,
      {
        resolved,
        enabledAxes: ["v1"],
      },
    );
    expect(pose).toEqual({ v1: 11, v2: 50, v3: 60 });
  });

  it("uses Cue values and zero for unspecified axes on the first dropped pose", () => {
    const empty: ActionSequenceConfig = {
      id: "empty",
      name: "empty",
      trajectoryMode: "non-forced",
      blocks: [],
      segments: [],
    };
    const pose = cueDropPoseForObject(cue, 7, 0, {
      resolved: resolveActionSequence(empty),
      enabledAxes: ["v1", "v2", "v3"],
    });
    expect(pose).toEqual({ v1: 11, v2: 0, v3: 33 });
  });

  it("rejects a Cue that has no target for the model", () => {
    const resolved = resolveActionSequence(sequence);
    expect(
      cueDropPoseForObject(cue, 8, 0, {
        resolved,
        enabledAxes: ["v1", "v2", "v3"],
      }),
    ).toBeNull();
  });

  it("does not keep a live cueId on the copied pose", () => {
    const resolved = resolveActionSequence(sequence);
    const pose = cueDropPoseForObject(cue, 7, 1500, {
      resolved,
    });
    expect(pose).not.toBeNull();
    expect(pose).not.toHaveProperty("cueId");
    cue.targets["7"] = { v1: 999 };
    expect(pose).toEqual({ v1: 11, v2: 50, v3: 33 });
  });
});
