import { describe, expect, it } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import type { CueItem } from "../components/action-builder/timeline/timeline-data";
import {
  resolveDimmedObjectIds,
  resolveMemberObjectIds,
  type MembershipDimInput,
} from "./membership-dim";

const cueA: CueItem = { id: "cue-a", name: "A", targets: { "1": { v1: 0 }, "2": { v1: 0 } } };
const cueB: CueItem = { id: "cue-b", name: "B", targets: { "2": { v1: 0 }, "3": { v1: 0 } } };

const sequence: ActionSequenceConfig = {
  id: "seq",
  name: "seq",
  trajectoryMode: "forced",
  blocks: [
    { id: "p", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 0, v2: 0, v3: 0 } },
    { id: "s", kind: "static-preset", presetId: "static-flat", orderedObjectIds: [4], params: {}, atMs: 0 },
  ],
  segments: [],
};

const base: MembershipDimInput = {
  activeNav: "sequences",
  dockMode: "empty",
  sequence: null,
  cues: [cueA, cueB],
  selectedCueId: null,
  transitionDraft: null,
  allObjectIds: [1, 2, 3, 4, 5],
  pickedObjectIds: [],
};

describe("resolveMemberObjectIds", () => {
  it("returns null outside sequences nav", () => {
    expect(
      resolveMemberObjectIds({ ...base, activeNav: "control", dockMode: "cue", selectedCueId: "cue-a" }),
    ).toBeNull();
  });

  it("returns null for empty dock", () => {
    expect(resolveMemberObjectIds(base)).toBeNull();
  });

  it("uses cue targets in cue mode", () => {
    const ids = resolveMemberObjectIds({ ...base, dockMode: "cue", selectedCueId: "cue-a" });
    expect([...ids!].sort()).toEqual([1, 2]);
  });

  it("returns null when cue id is stale", () => {
    expect(resolveMemberObjectIds({ ...base, dockMode: "cue", selectedCueId: "missing" })).toBeNull();
  });

  it("uses sequence blocks in sequence mode", () => {
    const ids = resolveMemberObjectIds({ ...base, dockMode: "sequence", sequence });
    expect([...ids!].sort()).toEqual([1, 4]);
  });

  it("returns null for sequence with no blocks", () => {
    expect(
      resolveMemberObjectIds({ ...base, dockMode: "sequence", sequence: { ...sequence, blocks: [] } }),
    ).toBeNull();
  });

  it("unions both cues in transition mode", () => {
    const ids = resolveMemberObjectIds({
      ...base,
      dockMode: "transition",
      transitionDraft: { fromCueId: "cue-a", toCueId: "cue-b" },
    });
    expect([...ids!].sort()).toEqual([1, 2, 3]);
  });

  it("returns null in transition mode when both cues are missing", () => {
    expect(
      resolveMemberObjectIds({
        ...base,
        dockMode: "transition",
        transitionDraft: { fromCueId: "x", toCueId: "y" },
      }),
    ).toBeNull();
  });
});

describe("resolveDimmedObjectIds", () => {
  it("returns [] when members are null", () => {
    expect(resolveDimmedObjectIds(base)).toEqual([]);
  });

  it("dims non-members", () => {
    const dimmed = resolveDimmedObjectIds({ ...base, dockMode: "cue", selectedCueId: "cue-a" });
    expect(dimmed.sort()).toEqual([3, 4, 5]);
  });

  it("keeps picked non-members opaque", () => {
    const dimmed = resolveDimmedObjectIds({
      ...base,
      dockMode: "cue",
      selectedCueId: "cue-a",
      pickedObjectIds: [3, 5],
    });
    expect(dimmed).toEqual([4]);
  });
});
