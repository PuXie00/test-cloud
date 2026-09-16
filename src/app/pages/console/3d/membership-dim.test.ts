import { describe, expect, it } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import {
  resolveDimmedObjectIds,
  resolveMemberObjectIds,
  type MembershipDimInput,
} from "./membership-dim";

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
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
  allObjectIds: [1, 2, 3, 4, 5],
  pickedObjectIds: [],
};

describe("resolveMemberObjectIds", () => {
  it("returns null for empty dock", () => {
    expect(resolveMemberObjectIds(base)).toBeNull();
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

  it("does not dim on control even when a sequence is present", () => {
    expect(
      resolveMemberObjectIds({ ...base, activeNav: "control", dockMode: "sequence", sequence }),
    ).toBeNull();
    expect(
      resolveDimmedObjectIds({ ...base, activeNav: "control", dockMode: "sequence", sequence }),
    ).toEqual([]);
  });
});

describe("resolveDimmedObjectIds", () => {
  it("returns [] when members are null", () => {
    expect(resolveDimmedObjectIds(base)).toEqual([]);
  });

  it("dims non-members", () => {
    const dimmed = resolveDimmedObjectIds({ ...base, dockMode: "sequence", sequence });
    expect(dimmed.sort()).toEqual([2, 3, 5]);
  });

  it("keeps picked non-members opaque", () => {
    const dimmed = resolveDimmedObjectIds({
      ...base,
      dockMode: "sequence",
      sequence,
      pickedObjectIds: [2, 5],
    });
    expect(dimmed).toEqual([3]);
  });
});
