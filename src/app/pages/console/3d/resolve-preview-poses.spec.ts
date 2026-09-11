import { describe, expect, it } from "vitest";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import type { CueItem } from "../components/action-builder/timeline/timeline-data";
import { resolvePreviewPoses } from "./resolve-preview-poses";

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: "start",
      kind: "pose",
      objectId: 7,
      atMs: 0,
      pose: { v1: 0, v2: 0, v3: 0 },
    },
    {
      id: "pose",
      kind: "pose",
      objectId: 7,
      atMs: 1000,
      pose: { v1: 1000, v2: 10, v3: 0 },
    },
  ],
  segments: [
    {
      fromRef: "start",
      toRef: "pose",
      settings: {
        profiles: createDefaultAxisProfiles(1000),
      },
    },
  ],
};

const cue: CueItem = {
  id: "cue-1",
  name: "Cue",
  targets: {
    "8": { v1: 2500, v2: 15 },
    "9": { v3: -30 },
  },
};

describe("resolvePreviewPoses", () => {
  it("maps cue targets onto member objects and fills missing axes with 0", () => {
    const poses = resolvePreviewPoses({
      dockMode: "cue",
      cue,
      sequence,
      cursorMs: 500,
    });
    expect(poses.get(8)).toEqual({ v1: 2500, v2: 15, v3: 0 });
    expect(poses.get(9)).toEqual({ v1: 0, v2: 0, v3: -30 });
    expect(poses.has(7)).toBe(false);
  });

  it("updates when cue targets change", () => {
    const next: CueItem = {
      ...cue,
      targets: { "8": { v1: 100 } },
    };
    const poses = resolvePreviewPoses({
      dockMode: "cue",
      cue: next,
      sequence,
      cursorMs: 500,
    });
    expect(poses.get(8)).toEqual({ v1: 100, v2: 0, v3: 0 });
    expect(poses.size).toBe(1);
  });

  it("interpolates the sequence at the cursor while editing a sequence", () => {
    const poses = resolvePreviewPoses({
      dockMode: "sequence",
      cue,
      sequence,
      cursorMs: 200,
    });
    expect(poses.get(7)?.v1).toBeCloseTo(125, 5);
    expect(poses.get(7)?.v2).toBeCloseTo(1.25, 5);
    expect(poses.get(7)?.v3).toBe(0);
    expect(poses.has(8)).toBe(false);
  });

  it("does not write poses in transition dock mode", () => {
    expect(
      resolvePreviewPoses({
        dockMode: "transition",
        cue,
        sequence,
        cursorMs: 500,
        virtualAxisObjectIds: new Set([7, 8]),
      }).size,
    ).toBe(0);
  });

  it("uses install poses for all virtual-axis objects when no cue or sequence is selected", () => {
    const ids = new Set([7, 8]);
    const empty = resolvePreviewPoses({
      dockMode: "empty",
      cue,
      sequence,
      cursorMs: 500,
      virtualAxisObjectIds: ids,
    });
    expect(empty.get(7)).toEqual({ v1: 0, v2: 0, v3: 0 });
    expect(empty.get(8)).toEqual({ v1: 0, v2: 0, v3: 0 });
    expect(empty.size).toBe(2);

    const missingCue = resolvePreviewPoses({
      dockMode: "cue",
      cue: null,
      sequence,
      cursorMs: 0,
      virtualAxisObjectIds: ids,
    });
    expect(missingCue.get(7)).toEqual({ v1: 0, v2: 0, v3: 0 });
    expect(missingCue.size).toBe(2);

    const missingSequence = resolvePreviewPoses({
      dockMode: "sequence",
      cue,
      sequence: null,
      cursorMs: 0,
      virtualAxisObjectIds: ids,
    });
    expect(missingSequence.get(8)).toEqual({ v1: 0, v2: 0, v3: 0 });
    expect(missingSequence.size).toBe(2);
  });
});
