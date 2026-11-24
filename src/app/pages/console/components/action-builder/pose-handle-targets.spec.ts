import { describe, expect, it } from "vitest";
import type { ActionSequenceConfig, TimelineBlock } from "@/app/project/action-sequence/types";
import {
  nearestPoseBlock,
  POSE_HANDLE_CONFLICT_HINT,
  POSE_HANDLE_OFF_CURSOR_HINT,
  POSE_HANDLE_PRESET_HINT,
  POSE_HANDLE_REF_HINT,
  poseBlocksAtCursor,
  poseHandleBlockReason,
  poseHandleStartValues,
  resolvePoseHandleEditTargets,
} from "./pose-handle-targets";

const pose = (id: string, objectId: number, atMs: number, values: Record<string, number> = { v1: 100 }): TimelineBlock => ({
  id,
  kind: "pose",
  objectId,
  atMs,
  pose: values,
});

const sequenceOf = (blocks: TimelineBlock[]): Pick<ActionSequenceConfig, "blocks"> => ({ blocks });

const info = (objectId: number) =>
  objectId === 9
    ? { controlType: "staticProp" as const, enabledAxes: [] }
    : objectId === 3
      ? { controlType: "multiPointSwing" as const, enabledAxes: ["v1" as const, "v2" as const, "v3" as const] }
      : { controlType: "singlePointMove" as const, enabledAxes: ["v1" as const] };

describe("poseBlocksAtCursor", () => {
  it("picks the poses on the cursor's time step", () => {
    const sequence = sequenceOf([pose("a", 1, 1000), pose("b", 2, 1000), pose("c", 1, 2000)]);
    expect(poseBlocksAtCursor(sequence, [1, 2], 1030).map((block) => block.id)).toEqual(["a", "b"]);
    expect(poseBlocksAtCursor(sequence, [1], 1500)).toEqual([]);
  });
});

describe("nearestPoseBlock", () => {
  it("prefers the earlier pose on a tie", () => {
    const sequence = sequenceOf([pose("a", 1, 1000), pose("b", 1, 3000), pose("c", 2, 2000)]);
    expect(nearestPoseBlock(sequence, 1, 2000)?.id).toBe("a");
    expect(nearestPoseBlock(sequence, 1, 2600)?.id).toBe("b");
    expect(nearestPoseBlock(sequence, 5, 2000)).toBeUndefined();
  });
});

describe("poseHandleBlockReason", () => {
  const blocks: TimelineBlock[] = [
    { id: "s", kind: "static-preset", presetId: "x", orderedObjectIds: [1], params: {}, atMs: 1000 },
    {
      id: "d",
      kind: "dynamic-preset",
      presetId: "y",
      orderedObjectIds: [2],
      params: {},
      startMs: 1000,
      endMs: 3000,
      profiles: {} as never,
    },
    {
      id: "r",
      kind: "sequence-ref",
      sequenceId: 7,
      atMs: 5000,
      durationMs: 2000,
      orderedObjectIds: [1],
      content: { name: "x", trajectoryMode: "smooth" as never, blocks: [], segments: [] },
    },
  ];
  it("blocks while a preset or a referenced sequence drives the object", () => {
    const sequence = sequenceOf(blocks);
    expect(poseHandleBlockReason(sequence, 1, 1000)).toBe(POSE_HANDLE_PRESET_HINT);
    expect(poseHandleBlockReason(sequence, 1, 1100)).toBeNull();
    expect(poseHandleBlockReason(sequence, 2, 3000)).toBe(POSE_HANDLE_PRESET_HINT);
    expect(poseHandleBlockReason(sequence, 2, 3100)).toBeNull();
    expect(poseHandleBlockReason(sequence, 1, 6000)).toBe(POSE_HANDLE_REF_HINT);
    expect(poseHandleBlockReason(sequence, 3, 6000)).toBeNull();
  });
});

describe("resolvePoseHandleEditTargets", () => {
  const base = {
    selection: null,
    selectedObjectIds: [] as number[],
    cursorMs: 1000,
    liveMode: false,
    objectInfo: info,
  };

  it("edits the pose on the cursor, or adds one there when dragged", () => {
    const sequence = sequenceOf([pose("a", 1, 1000)]);
    expect(resolvePoseHandleEditTargets({ ...base, sequence, selectedObjectIds: [1, 2, 9] })).toEqual([
      { objectId: 1, blockId: "a", atMs: 1000, kinds: ["lift"], blockedReason: null },
      { objectId: 2, blockId: null, atMs: 1000, kinds: ["lift"], blockedReason: null },
    ]);
  });

  it("edits the selected pose, and blocks it off the cursor unless live", () => {
    const sequence = sequenceOf([pose("a", 1, 1000), pose("b", 1, 2000)]);
    const selection = { kind: "block" as const, blockId: "b" };
    expect(resolvePoseHandleEditTargets({ ...base, sequence, selection })[0]).toMatchObject({
      blockId: "b",
      atMs: 2000,
      blockedReason: POSE_HANDLE_OFF_CURSOR_HINT,
    });
    expect(resolvePoseHandleEditTargets({ ...base, sequence, selection, liveMode: true })[0]).toMatchObject({
      blockId: "b",
      blockedReason: null,
    });
  });

  it("refuses two selected poses of the same object", () => {
    const sequence = sequenceOf([pose("a", 1, 1000), pose("b", 1, 2000)]);
    const selection = { kind: "multi-block" as const, blockIds: ["a", "b"] };
    expect(resolvePoseHandleEditTargets({ ...base, sequence, selection })[0]?.blockedReason).toBe(
      POSE_HANDLE_CONFLICT_HINT,
    );
  });

  it("gives a multi-point swing its lift and stick", () => {
    const sequence = sequenceOf([]);
    expect(resolvePoseHandleEditTargets({ ...base, sequence, selectedObjectIds: [3] })[0]?.kinds).toEqual([
      "lift",
      "swing",
    ]);
  });
});

describe("poseHandleStartValues", () => {
  const block = { id: "a", kind: "pose" as const, objectId: 1, atMs: 1000, pose: { v1: 500 } };

  it("starts from what the 3D shows, with the pose's set axes", () => {
    expect(
      poseHandleStartValues({
        block,
        liveMode: false,
        shadow: undefined,
        shown: { v1: 480, v2: 3, v3: 40 },
        evaluated: undefined,
        live: null,
      }),
    ).toEqual({ values: { v1: 500, v2: 3, v3: 40 }, onShadow: false });
  });

  it("sits on the GO shadow when live", () => {
    expect(
      poseHandleStartValues({
        block,
        liveMode: true,
        shadow: { v1: 500, v2: 7 },
        shown: { v1: 0, v2: 0, v3: 0 },
        evaluated: { v1: 500, v2: 1, v3: 2 },
        live: { v1: 0, v2: 7, v3: 9 },
      }),
    ).toEqual({ values: { v1: 500, v2: 7, v3: 2 }, onShadow: true });
  });
});
