import { describe, expect, it } from "vitest";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  AxisMotionProfiles,
  ModelPose,
} from "@/app/project/action-sequence/types";
import {
  applyPoseAxisWrite,
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
  trajectoryMode: false,
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
  trajectoryMode: false,
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

  it("snaps moved atMs onto the 100ms grid", () => {
    const sequence: ActionSequenceConfig = {
      id: 1,
      name: "Snap",
      trajectoryMode: false,
      blocks: [{ id: "pose-a", kind: "pose", objectId: 7, atMs: 1000, pose: origin }],
      segments: [],
    };
    const next = moveTimelineBlock(sequence, "pose-a", 147);
    expect(next.blocks.find((block) => block.id === "pose-a")).toMatchObject({ atMs: 100 });
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
      trajectoryMode: false,
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
      trajectoryMode: false,
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
      trajectoryMode: false,
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
      trajectoryMode: false,
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
      trajectoryMode: false,
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

  it("snaps negative atMs to 0 on insert", () => {
    const empty: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: false,
      blocks: [],
      segments: [],
    };
    const result = insertTimelineBlock(empty, {
      id: "pose",
      kind: "pose",
      objectId: 7,
      atMs: -1,
      pose: origin,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sequence.blocks.find((block) => block.id === "pose")).toMatchObject({ atMs: 0 });
  });

  it("deleteTimelineBlocks returns a sequence when a preset id is unknown", () => {
    const authored: ActionSequenceConfig = {
      id: 99,
      name: "Unknown",
      trajectoryMode: false,
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

const multiPoseSequence: ActionSequenceConfig = {
  id: 10,
  name: "Multi pose",
  trajectoryMode: false,
  blocks: [
    { id: "pose-a", kind: "pose", objectId: 1, atMs: 100, pose: { v1: 10, v2: 1, v3: 0 } },
    { id: "pose-b", kind: "pose", objectId: 2, atMs: 200, pose: { v1: 20, v2: 5, v3: 2 } },
    {
      id: "enable",
      kind: "instruction",
      presetId: "set-enabled",
      objectId: 1,
      atMs: 50,
      instr: { enabled: true },
    },
  ],
  segments: [],
};

const multiPoseObjectInfo = (objectId: number) => {
  if (objectId === 1) {
    return {
      enabledAxes: ["v1", "v2"] as const,
      rangeByAxis: { v1: { min: 0, max: 15 } },
    };
  }
  if (objectId === 2) {
    return {
      enabledAxes: ["v1"] as const,
      rangeByAxis: { v1: { min: 0, max: 100 } },
    };
  }
  return undefined;
};

const poseOf = (sequence: ActionSequenceConfig, id: string) => {
  const block = sequence.blocks.find((item) => item.id === id);
  if (block === undefined || block.kind !== "pose") {
    throw new Error(`missing pose ${id}`);
  }
  return block;
};

describe("applyPoseAxisWrite", () => {
  it("sets the same absolute value on selected poses that have the axis", () => {
    const result = applyPoseAxisWrite(
      multiPoseSequence,
      ["pose-a", "pose-b"],
      { mode: "abs", axis: "v1", value: 12 },
      { objectInfo: multiPoseObjectInfo },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(poseOf(result.sequence, "pose-a").pose).toEqual({ v1: 12, v2: 1, v3: 0 });
    expect(poseOf(result.sequence, "pose-b").pose).toEqual({ v1: 12, v2: 5, v3: 2 });
  });

  it("adds a relative delta on selected poses that have the axis", () => {
    const result = applyPoseAxisWrite(
      multiPoseSequence,
      ["pose-a", "pose-b"],
      { mode: "rel", axis: "v1", value: 5 },
      { objectInfo: multiPoseObjectInfo },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(poseOf(result.sequence, "pose-a").pose.v1).toBe(15);
    expect(poseOf(result.sequence, "pose-b").pose.v1).toBe(25);
  });

  it("skips poses whose object does not have the axis", () => {
    const result = applyPoseAxisWrite(
      multiPoseSequence,
      ["pose-a", "pose-b"],
      { mode: "abs", axis: "v2", value: 8 },
      { objectInfo: multiPoseObjectInfo },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(poseOf(result.sequence, "pose-a").pose.v2).toBe(8);
    expect(poseOf(result.sequence, "pose-b").pose.v2).toBe(5);
  });

  it("clamps each pose to that object's range", () => {
    const result = applyPoseAxisWrite(
      multiPoseSequence,
      ["pose-a", "pose-b"],
      { mode: "abs", axis: "v1", value: 50 },
      { objectInfo: multiPoseObjectInfo },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(poseOf(result.sequence, "pose-a").pose.v1).toBe(15);
    expect(poseOf(result.sequence, "pose-b").pose.v1).toBe(50);
  });

  it("does not change atMs and ignores non-pose ids", () => {
    const result = applyPoseAxisWrite(
      multiPoseSequence,
      ["pose-a", "enable"],
      { mode: "abs", axis: "v1", value: 11 },
      { objectInfo: multiPoseObjectInfo },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(poseOf(result.sequence, "pose-a")).toMatchObject({ atMs: 100, pose: { v1: 11, v2: 1, v3: 0 } });
    expect(poseOf(result.sequence, "pose-b")).toMatchObject({ atMs: 200, pose: { v1: 20, v2: 5, v3: 2 } });
    expect(result.sequence.blocks.find((block) => block.id === "enable")).toEqual(
      multiPoseSequence.blocks.find((block) => block.id === "enable"),
    );
  });

  it("returns the same sequence when the write changes nothing", () => {
    const absSame = applyPoseAxisWrite(
      multiPoseSequence,
      ["pose-a"],
      { mode: "abs", axis: "v1", value: 10 },
      { objectInfo: multiPoseObjectInfo },
    );
    expect(absSame).toEqual({ ok: true, sequence: multiPoseSequence });
    const relZero = applyPoseAxisWrite(
      multiPoseSequence,
      ["pose-a", "pose-b"],
      { mode: "rel", axis: "v1", value: 0 },
      { objectInfo: multiPoseObjectInfo },
    );
    expect(relZero).toEqual({ ok: true, sequence: multiPoseSequence });
  });

  it("treats missing enabledAxes as all three axes", () => {
    const result = applyPoseAxisWrite(
      multiPoseSequence,
      ["pose-b"],
      { mode: "abs", axis: "v3", value: 9 },
      { objectInfo: () => undefined },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(poseOf(result.sequence, "pose-b").pose.v3).toBe(9);
  });
});

describe("block copy / paste with motion segments", () => {
  const twoPoses: ActionSequenceConfig = {
    id: 3,
    name: "Poses",
    trajectoryMode: false,
    blocks: [
      { id: "pose-a", kind: "pose", objectId: 7, atMs: 1000, pose: origin },
      { id: "pose-b", kind: "pose", objectId: 7, atMs: 3000, pose: { v1: 100, v2: 0, v3: 0 } },
    ],
    segments: [],
  };
  const tuned = updateSegmentSettings(twoPoses, "pose-a", "pose-b", {
    profiles: movingV1IdleOthers(400, 300),
  });
  const tunedSettings = tuned.segments.find(
    (segment) => segment.fromRef === "pose-a" && segment.toRef === "pose-b",
  )?.settings;

  const pastedSegment = (sequence: ActionSequenceConfig, createdIds: string[]) =>
    sequence.segments.find(
      (segment) => segment.fromRef === createdIds[0] && segment.toRef === createdIds[1],
    );

  it("copies the motion segment between two connected blocks", () => {
    const clipboard = copyTimelineBlocks(tuned, ["pose-a", "pose-b"]);
    expect(clipboard.segments).toEqual([
      { fromRef: "pose-a", toRef: "pose-b", settings: tunedSettings },
    ]);
    expect(copyTimelineBlocks(tuned, ["pose-a"]).segments).toEqual([]);
  });

  it("pastes the copied segment settings onto the new blocks", () => {
    const pasted = pasteTimelineBlocks(tuned, copyTimelineBlocks(tuned, ["pose-a", "pose-b"]), 10_000);
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    expect(pasted.createdIds).toHaveLength(2);
    expect(pastedSegment(pasted.sequence, pasted.createdIds)?.settings).toEqual(tunedSettings);
    expect(pasted.droppedBlocks).toBe(0);
  });

  it("pastes onto other objects, one copy per object map", () => {
    const pasted = pasteTimelineBlocks(
      tuned,
      copyTimelineBlocks(tuned, ["pose-a", "pose-b"]),
      1000,
      undefined,
      [new Map([[7, 8]]), new Map([[7, 9]])],
    );
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    const created = pasted.sequence.blocks.filter((block) => pasted.createdIds.includes(block.id));
    expect(created.map((block) => (block.kind === "pose" ? block.objectId : null))).toEqual([
      8, 8, 9, 9,
    ]);
    expect(pastedSegment(pasted.sequence, pasted.createdIds.slice(0, 2))?.settings).toEqual(
      tunedSettings,
    );
    expect(pastedSegment(pasted.sequence, pasted.createdIds.slice(2))?.settings).toEqual(
      tunedSettings,
    );
  });

  it("rewrites preset segment refs to the new block and object", () => {
    const withPreset: ActionSequenceConfig = {
      ...sequenceWithStaticPreset,
      blocks: [
        ...sequenceWithStaticPreset.blocks,
        { id: "pose-after", kind: "pose", objectId: 7, atMs: 3000, pose: { v1: 50, v2: 0, v3: 0 } },
      ],
    };
    const source = resolveActionSequence(withPreset).segments.find(
      (segment) => segment.objectId === 7 && segment.toRef === "pose-after",
    );
    expect(source?.fromRef.startsWith("preset:preset-1:7:")).toBe(true);
    const tunedPreset = updateSegmentSettings(withPreset, source!.fromRef, "pose-after", {
      profiles: movingV1IdleOthers(200, 200),
    });
    const pasted = pasteTimelineBlocks(
      tunedPreset,
      copyTimelineBlocks(tunedPreset, ["preset-1", "pose-after"]),
      10_000,
      undefined,
      [new Map([[9, 19], [7, 17], [8, 18]])],
    );
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    const [presetId, poseId] = pasted.createdIds;
    const segment = pasted.sequence.segments.find((item) => item.toRef === poseId);
    expect(segment?.fromRef).toBe(source!.fromRef.replace("preset:preset-1:7:", `preset:${presetId}:17:`));
    expect(segment?.settings.profiles.v1).toEqual(
      tunedPreset.segments.find((item) => item.toRef === "pose-after")?.settings.profiles.v1,
    );
  });

  it("skips blocks whose objects have no mapping and reports them", () => {
    const withPreset: ActionSequenceConfig = {
      ...sequenceWithStaticPreset,
      blocks: [
        ...sequenceWithStaticPreset.blocks,
        { id: "pose-after", kind: "pose", objectId: 7, atMs: 3000, pose: origin },
      ],
    };
    const pasted = pasteTimelineBlocks(
      withPreset,
      copyTimelineBlocks(withPreset, ["preset-1", "pose-after"]),
      10_000,
      undefined,
      [new Map([[7, 7]])],
    );
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    expect(pasted.droppedBlocks).toBe(1);
    expect(pasted.createdIds).toHaveLength(1);
  });

  it("refuses a paste that overlaps motion on the target object", () => {
    const pasted = pasteTimelineBlocks(
      sequenceWithDynamicPreset,
      copyTimelineBlocks(tuned, ["pose-a"]),
      1500,
    );
    expect(pasted).toEqual({ ok: false, reason: "motion-overlap" });
  });
});
