import { describe, expect, it } from "vitest";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { resolvePreviewPoses } from "./resolve-preview-poses";

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: false,
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

describe("resolvePreviewPoses", () => {
  it("interpolates the sequence at the cursor while editing a sequence", () => {
    const poses = resolvePreviewPoses({
      dockMode: "sequence",
      sequence,
      cursorMs: 200,
    });
    expect(poses.get(7)?.v1).toBeCloseTo(125, 5);
    expect(poses.get(7)?.v2).toBeCloseTo(1.25, 5);
    expect(poses.get(7)?.v3).toBe(0);
    expect(poses.has(8)).toBe(false);
  });

  it("uses install poses for all virtual-axis objects when no sequence is selected", () => {
    const ids = new Set([7, 8]);
    const empty = resolvePreviewPoses({
      dockMode: "empty",
      sequence,
      cursorMs: 500,
      virtualAxisObjectIds: ids,
    });
    expect(empty.get(7)).toEqual({ v1: 0, v2: 0, v3: 0 });
    expect(empty.get(8)).toEqual({ v1: 0, v2: 0, v3: 0 });
    expect(empty.size).toBe(2);

    const missingSequence = resolvePreviewPoses({
      dockMode: "sequence",
      sequence: null,
      cursorMs: 0,
      virtualAxisObjectIds: ids,
    });
    expect(missingSequence.get(8)).toEqual({ v1: 0, v2: 0, v3: 0 });
    expect(missingSequence.size).toBe(2);
  });
});
