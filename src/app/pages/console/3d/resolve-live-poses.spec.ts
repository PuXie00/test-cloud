import { describe, expect, it } from "vitest";
import {
  mergeHoldPoses,
  resolveLivePoses,
} from "./resolve-live-poses";
import type { ModelPose } from "@/app/project/action-sequence/types";

const pose = (v1: number, v2 = 0, v3 = 0): ModelPose => ({ v1, v2, v3 });

describe("resolveLivePoses", () => {
  it("maps monitor h/p/y onto virtual-axis objects", () => {
    const poses = resolveLivePoses(
      [
        { id: 7, positions: { h: 1200, p: 5, y: -10 } },
        { id: 8, positions: { h: 400 } },
      ],
      new Set([7, 8]),
    );
    expect(poses.get(7)).toEqual({ v1: 1200, v2: 5, v3: -10 });
    expect(poses.get(8)).toEqual({ v1: 400, v2: 0, v3: 0 });
  });

  it("uses install pose (virtual axes 0) when telemetry is missing", () => {
    const poses = resolveLivePoses(
      [
        { id: 7, positions: null },
        { id: 8, positions: {} },
        { id: 9, positions: { h: 10 } },
      ],
      new Set([7, 8]),
    );
    expect(poses.get(7)).toEqual(pose(0));
    expect(poses.get(8)).toEqual(pose(0));
    expect(poses.has(9)).toBe(false);
  });

  it("fills install pose for virtual-axis objects absent from snapshots", () => {
    const poses = resolveLivePoses([], new Set([7]));
    expect(poses.get(7)).toEqual(pose(0));
  });
});

describe("mergeHoldPoses", () => {
  it("returns preview poses when not holding", () => {
    const preview = new Map([[7, pose(50)]]);
    const live = new Map([[7, pose(999)], [8, pose(1)]]);
    expect(mergeHoldPoses(preview, live, false)).toEqual(preview);
  });

  it("replaces preview with live poses while holding", () => {
    const preview = new Map([
      [7, pose(50)],
      [8, pose(80)],
    ]);
    const live = new Map([[7, pose(999)], [8, pose(0)], [9, pose(0)]]);
    const merged = mergeHoldPoses(preview, live, true);
    expect(merged.get(7)).toEqual(pose(999));
    expect(merged.get(8)).toEqual(pose(0));
    expect(merged.get(9)).toEqual(pose(0));
    expect(merged.size).toBe(3);
  });
});
