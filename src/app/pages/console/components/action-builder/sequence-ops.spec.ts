import { describe, expect, it } from "vitest";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  AxisMotionProfiles,
  ModelPose,
} from "@/app/project/action-sequence/types";
import {
  copyTimelineBlocks,
  deleteTimelineBlocks,
  insertTimelineBlock,
  moveTimelineBlock,
  pasteTimelineBlocks,
  replaceTimelineBlock,
  resizeDynamicPreset,
  shiftTimelineBlocks,
  updateSegmentSettings,
} from "./sequence-ops";

const origin: ModelPose = { v1: 0, v2: 0, v3: 0 };

const axisProfiles = (accelMs: number, decelMs: number): AxisMotionProfiles => ({
  v1: { kind: "trapezoid", params: { accelMs, decelMs } },
  v2: { kind: "trapezoid", params: { accelMs, decelMs } },
  v3: { kind: "trapezoid", params: { accelMs, decelMs } },
});

const movingV1IdleOthers = (accelMs: number, decelMs: number): AxisMotionProfiles => ({
  v1: { kind: "trapezoid", params: { accelMs, decelMs } },
  v2: { kind: "idle" },
  v3: { kind: "idle" },
});

const sequenceWithStaticPreset: ActionSequenceConfig = {
  id: 1,
  name: "Static",
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: "preset-1",
      kind: "static-preset",
      presetId: "static-slope",
      atMs: 1000,
      orderedObjectIds: [9, 7, 8],
      params: { baseV1: 0, stepV1: 100, v2: 0, v3: 0 },
    },
  ],
  segments: [],
};

const sequenceWithDynamicPreset: ActionSequenceConfig = {
  id: 2,
  name: "Dynamic",
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: "dynamic-1",
      kind: "dynamic-preset",
      presetId: "dynamic-level",
      startMs: 1000,
      endMs: 2000,
      orderedObjectIds: [7, 8],
      params: { startV1: 0, targetV1: 100, v2: 0, v3: 0 },
      profiles: axisProfiles(1, 1),
    },
  ],
  segments: [],
};

describe("sequence-ops", () => {
  it("moves every projection by moving one shared preset block", () => {
    const next = moveTimelineBlock(sequenceWithStaticPreset, "preset-1", 2500);
    expect(next.blocks.find((block) => block.id === "preset-1")).toMatchObject({ atMs: 2500 });
    expect(next.blocks.filter((block) => block.id === "preset-1")).toHaveLength(1);
  });

  it("rejects a dynamic preset overlap for a participant", () => {
    const result = insertTimelineBlock(sequenceWithDynamicPreset, {
      id: "pose",
      kind: "pose",
      objectId: 7,
      atMs: 1500,
      pose: { v1: 1, v2: 2, v3: 3 },
    });
    expect(result).toEqual({ ok: false, reason: "motion-overlap" });
  });

  it("copy/paste gives one preset a new identity and preserves participant order", () => {
    const clipboard = copyTimelineBlocks(sequenceWithStaticPreset, ["preset-1"]);
    const pasted = pasteTimelineBlocks(sequenceWithStaticPreset, clipboard, 3000);
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) throw new Error(pasted.reason);
    const copy = pasted.sequence.blocks.find((block) => block.id === pasted.createdIds[0]);
    expect(copy?.id).not.toBe("preset-1");
    expect(copy).toMatchObject({ orderedObjectIds: [9, 7, 8], atMs: 3000 });
  });

  it("persists default motion profiles after a successful edit", () => {
    const authored: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "pose-0",
          kind: "pose",
          objectId: 7,
          atMs: 0,
          pose: origin,
        },
      ],
      segments: [],
    };
    const result = insertTimelineBlock(authored, {
      id: "pose-1",
      kind: "pose",
      objectId: 7,
      atMs: 2000,
      pose: { v1: 1, v2: 0, v3: 0 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.sequence.segments).toEqual([
      {
        fromRef: "pose-0",
        toRef: "pose-1",
        settings: { profiles: movingV1IdleOthers(400, 400) },
      },
    ]);
    expect(resolveActionSequence(result.sequence).segments[0]?.settings).toEqual({
      profiles: movingV1IdleOthers(400, 400),
    });
  });

  it("defaults new segment profiles from minAccelTime when inserting a pose", () => {
    const authored: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "pose-0",
          kind: "pose",
          objectId: 7,
          atMs: 0,
          pose: origin,
        },
      ],
      segments: [],
    };
    const result = insertTimelineBlock(
      authored,
      {
        id: "pose-1",
        kind: "pose",
        objectId: 7,
        atMs: 5000,
        pose: { v1: 1, v2: 0, v3: 0 },
      },
      {
        minAccelTimeByObject: () => ({ v1: 1, v2: 0.5 }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.sequence.segments[0]?.settings.profiles.v1).toEqual({
      kind: "trapezoid",
      params: { accelMs: 1000, decelMs: 1000 },
    });
    expect(result.sequence.segments[0]?.settings.profiles.v2).toEqual({ kind: "idle" });
  });

  it("preserves accelMs and decelMs when shifting a pose changes segment duration", () => {
    const authored: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        { id: "pose-a", kind: "pose", objectId: 7, atMs: 1000, pose: origin },
        { id: "pose-b", kind: "pose", objectId: 7, atMs: 5000, pose: { v1: 1, v2: 0, v3: 0 } },
      ],
      segments: [
        {
          fromRef: "pose-a",
          toRef: "pose-b",
          settings: { profiles: axisProfiles(1000, 1000) },
        },
      ],
    };
    const shifted = shiftTimelineBlocks(authored, ["pose-b"], 1000);
    const resolved = resolveActionSequence(shifted);
    expect(resolved.segments[0]?.durationMs).toBe(5000);
    expect(resolved.segments[0]?.settings.profiles).toEqual(movingV1IdleOthers(1000, 1000));
  });

  it("allows a pose on a dynamic preset endpoint and a set-enabled inside the range", () => {
    const atStart = insertTimelineBlock(sequenceWithDynamicPreset, {
      id: "at-start",
      kind: "pose",
      objectId: 7,
      atMs: 1000,
      pose: { v1: 0, v2: 0, v3: 0 },
    });
    expect(atStart.ok).toBe(true);

    const command = insertTimelineBlock(sequenceWithDynamicPreset, {
      id: "enable-1",
      kind: "instruction",
      presetId: "set-enabled",
      objectId: 7,
      atMs: 1500,
      instr: { enabled: true },
    });
    expect(command.ok).toBe(true);
    if (!command.ok) throw new Error(command.reason);
    expect(command.sequence.blocks.some((block) => block.id === "enable-1")).toBe(true);
  });

  it("rejects moving a pose into a participant's dynamic range", () => {
    const withPose: ActionSequenceConfig = {
      ...sequenceWithDynamicPreset,
      blocks: [
        ...sequenceWithDynamicPreset.blocks,
        { id: "pose-out", kind: "pose", objectId: 7, atMs: 4000, pose: { v1: 1, v2: 0, v3: 0 } },
      ],
    };
    const next = moveTimelineBlock(withPose, "pose-out", 1500);
    expect(next).toBe(withPose);
    expect(withPose.blocks.find((block) => block.id === "pose-out")).toMatchObject({ atMs: 4000 });
  });

  it("rejects replace and resize when they would overlap", () => {
    const withPose: ActionSequenceConfig = {
      ...sequenceWithDynamicPreset,
      blocks: [
        ...sequenceWithDynamicPreset.blocks,
        { id: "pose-out", kind: "pose", objectId: 7, atMs: 4000, pose: { v1: 1, v2: 0, v3: 0 } },
      ],
    };
    expect(
      replaceTimelineBlock(withPose, {
        id: "pose-out",
        kind: "pose",
        objectId: 7,
        atMs: 1500,
        pose: { v1: 1, v2: 0, v3: 0 },
      }),
    ).toEqual({ ok: false, reason: "motion-overlap" });
    expect(resizeDynamicPreset(sequenceWithDynamicPreset, "dynamic-1", 1000, 500)).toEqual({
      ok: false,
      reason: "invalid-time-range",
    });
  });

  it("rejects paste that would overlap a participant", () => {
    const clipboard = copyTimelineBlocks(sequenceWithDynamicPreset, ["dynamic-1"]);
    const pasted = pasteTimelineBlocks(sequenceWithDynamicPreset, clipboard, 1500);
    expect(pasted).toEqual({ ok: false, reason: "motion-overlap" });
  });

  it("persists reviewed segment settings and drops deleted-block configs", () => {
    const authored: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "pose-0",
          kind: "pose",
          objectId: 7,
          atMs: 0,
          pose: origin,
        },
        {
          id: "pose-1",
          kind: "pose",
          objectId: 7,
          atMs: 2000,
          pose: { v1: 1, v2: 0, v3: 0 },
        },
      ],
      segments: [],
    };
    const reviewed = updateSegmentSettings(authored, "pose-0", "pose-1", {
      profiles: axisProfiles(100, 300),
    });
    expect(reviewed.segments).toEqual([
      {
        fromRef: "pose-0",
        toRef: "pose-1",
        settings: { profiles: movingV1IdleOthers(100, 300) },
      },
    ]);
    const deleted = deleteTimelineBlocks(reviewed, ["pose-1"]);
    expect(deleted.blocks.map((block) => block.id)).toEqual(["pose-0"]);
    expect(deleted.segments).toEqual([]);
  });

  it("does not mutate the input sequence", () => {
    const snapshot = structuredClone(sequenceWithStaticPreset);
    moveTimelineBlock(sequenceWithStaticPreset, "preset-1", 2500);
    insertTimelineBlock(sequenceWithDynamicPreset, {
      id: "pose",
      kind: "pose",
      objectId: 7,
      atMs: 1500,
      pose: { v1: 1, v2: 2, v3: 3 },
    });
    expect(sequenceWithStaticPreset).toEqual(snapshot);
  });

  it("shifts selected blocks by the same delta and clamps so none go below 0", () => {
    const authored: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        { id: "pose-a", kind: "pose", objectId: 7, atMs: 1000, pose: origin },
        { id: "pose-b", kind: "pose", objectId: 7, atMs: 3000, pose: { v1: 1, v2: 0, v3: 0 } },
      ],
      segments: [],
    };
    const shifted = shiftTimelineBlocks(authored, ["pose-a", "pose-b"], 500);
    expect(shifted.blocks.find((block) => block.id === "pose-a")).toMatchObject({ atMs: 1500 });
    expect(shifted.blocks.find((block) => block.id === "pose-b")).toMatchObject({ atMs: 3500 });

    const clamped = shiftTimelineBlocks(authored, ["pose-a", "pose-b"], -4000);
    expect(clamped.blocks.find((block) => block.id === "pose-a")).toMatchObject({ atMs: 0 });
    expect(clamped.blocks.find((block) => block.id === "pose-b")).toMatchObject({ atMs: 2000 });
  });

  it("does not apply a group shift that would overlap a dynamic range", () => {
    const withPose: ActionSequenceConfig = {
      ...sequenceWithDynamicPreset,
      blocks: [
        ...sequenceWithDynamicPreset.blocks,
        { id: "pose-out", kind: "pose", objectId: 7, atMs: 4000, pose: { v1: 1, v2: 0, v3: 0 } },
      ],
    };
    const next = shiftTimelineBlocks(withPose, ["pose-out"], -2500);
    expect(next).toBe(withPose);
  });

  it("rejects insertTimelineBlock with atMs: -1 as invalid-time-range", () => {
    const empty: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [],
      segments: [],
    };
    expect(
      insertTimelineBlock(empty, {
        id: "pose",
        kind: "pose",
        objectId: 7,
        atMs: -1,
        pose: origin,
      }),
    ).toEqual({ ok: false, reason: "invalid-time-range" });
  });

  it("deleteTimelineBlocks returns a sequence when a preset id is unknown", () => {
    const authored: ActionSequenceConfig = {
      id: 99,
      name: "Unknown",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "bad-preset",
          kind: "static-preset",
          presetId: "not-a-preset",
          atMs: 1000,
          orderedObjectIds: [7],
          params: { v1: 0, v2: 0, v3: 0 },
        },
      ],
      segments: [],
    };
    expect(() => deleteTimelineBlocks(authored, ["bad-preset"])).not.toThrow();
    const deleted = deleteTimelineBlocks(authored, ["bad-preset"]);
    expect(deleted.blocks).toEqual([]);
  });
});
