import { describe, expect, it } from "vitest";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import {
  advancePreviewCursor,
  memberObjectIds,
  previewPosesAt,
  sampleSequencePaths,
} from "./sequence-preview";

const moving: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: "forced",
  blocks: [
    { id: "a", kind: "pose", objectId: 7, atMs: 0, pose: { v1: 0, v2: 0, v3: 0 } },
    { id: "b", kind: "pose", objectId: 7, atMs: 1050, pose: { v1: 100, v2: 0, v3: 0 } },
    { id: "c", kind: "pose", objectId: 9, atMs: 500, pose: { v1: 5, v2: 0, v3: 0 } },
  ],
  segments: [{ fromRef: "a", toRef: "b", settings: { profiles: createDefaultAxisProfiles(1050) } }],
};

describe("sampleSequencePaths", () => {
  it("samples every 100ms plus segment boundaries, sorted and unique", () => {
    const resolved = resolveActionSequence(moving);
    const samples = sampleSequencePaths(resolved).get(7)!;
    const times = samples.map((s) => s.atMs);
    expect(times[0]).toBe(0);
    expect(times).toContain(1000);
    expect(times).toContain(1050);
    expect(new Set(times).size).toBe(times.length);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(samples[0]!.pose.v1).toBe(0);
    expect(samples[samples.length - 1]!.pose.v1).toBe(100);
  });
});

describe("previewPosesAt", () => {
  it("returns the authored start pose at cursor 0", () => {
    const poses = previewPosesAt(resolveActionSequence(moving), 0);
    expect(poses.get(7)).toEqual({ v1: 0, v2: 0, v3: 0 });
    expect(poses.get(9)).toEqual({ v1: 5, v2: 0, v3: 0 });
  });
  it("returns one pose per member at the cursor, not start/end ghosts", () => {
    const poses = previewPosesAt(resolveActionSequence(moving), 500);
    expect([...poses.keys()].sort()).toEqual([7, 9]);
    expect(poses.get(7)!.v1).toBeGreaterThan(0);
    expect(poses.get(7)!.v1).toBeLessThan(100);
    expect(poses.get(9)).toEqual({ v1: 5, v2: 0, v3: 0 });
  });
  it("returns the end pose at totalMs", () => {
    const resolved = resolveActionSequence(moving);
    const poses = previewPosesAt(resolved, resolved.totalMs);
    expect(poses.get(7)).toEqual({ v1: 100, v2: 0, v3: 0 });
  });
});

describe("memberObjectIds", () => {
  it("lists objects with poses", () => {
    expect(memberObjectIds(resolveActionSequence(moving)).sort()).toEqual([7, 9]);
  });
});

describe("advancePreviewCursor", () => {
  it("scales by fader percent and multiplier", () => {
    expect(
      advancePreviewCursor({ cursorMs: 0, dtMs: 100, faderPercent: 150, multiplier: 2, totalMs: 5000, loop: false }),
    ).toEqual({ cursorMs: 300, ended: false });
  });
  it("clamps at total when not looping", () => {
    expect(
      advancePreviewCursor({ cursorMs: 4950, dtMs: 100, faderPercent: 100, multiplier: 1, totalMs: 5000, loop: false }),
    ).toEqual({ cursorMs: 5000, ended: true });
  });
  it("wraps when looping", () => {
    expect(
      advancePreviewCursor({ cursorMs: 4950, dtMs: 100, faderPercent: 100, multiplier: 1, totalMs: 5000, loop: true }),
    ).toEqual({ cursorMs: 50, ended: false });
  });
});
