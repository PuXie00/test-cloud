import { describe, expect, it } from "vitest";
import { resolveActionSequence } from "./resolve-sequence";
import {
  actionSequencePathIsClosed,
  isSequenceLooping,
  posesAreClosed,
  reconcileSequenceLoop,
  sequencePathIsClosed,
} from "./sequence-loop";
import type { ActionSequenceConfig, ModelPose, PoseBlock } from "./types";

const pose = (v1: number, v2 = 0, v3 = 0): ModelPose => ({ v1, v2, v3 });

const poseBlock = (id: string, atMs: number, values: ModelPose, objectId = 7): PoseBlock => ({
  id,
  kind: "pose",
  objectId,
  atMs,
  pose: values,
});

const sequenceOf = (blocks: PoseBlock[], loop?: boolean): ActionSequenceConfig => ({
  id: 1,
  name: "Seq",
  trajectoryMode: false,
  ...(loop !== undefined ? { loop } : {}),
  blocks,
  segments: [],
});

describe("posesAreClosed", () => {
  it("treats identical poses as closed", () => {
    expect(posesAreClosed(pose(0, 1, 2), pose(0, 1, 2))).toBe(true);
  });

  it("allows 1mm on v1 and 0.1° on rotation", () => {
    expect(posesAreClosed(pose(10, 5, -3), pose(11, 5.1, -3.1))).toBe(true);
  });

  it("rejects gaps beyond the epsilon", () => {
    expect(posesAreClosed(pose(10), pose(11.1))).toBe(false);
    expect(posesAreClosed(pose(0, 0), pose(0, 0.11))).toBe(false);
    expect(posesAreClosed(pose(0, 0, 0), pose(0, 0, 0.11))).toBe(false);
  });
});

describe("sequencePathIsClosed", () => {
  it("is false for an empty sequence", () => {
    expect(sequencePathIsClosed(resolveActionSequence(sequenceOf([])))).toBe(false);
    expect(actionSequencePathIsClosed(sequenceOf([]))).toBe(false);
  });

  it("is true for a single pose per object", () => {
    expect(actionSequencePathIsClosed(sequenceOf([poseBlock("a", 0, pose(40))]))).toBe(true);
  });

  it("is true when every member returns to its start pose", () => {
    expect(
      actionSequencePathIsClosed(
        sequenceOf([
          poseBlock("a", 0, pose(0), 7),
          poseBlock("b", 1000, pose(100), 7),
          poseBlock("c", 2000, pose(0), 7),
          poseBlock("d", 0, pose(5, 10), 8),
          poseBlock("e", 2000, pose(5, 10), 8),
        ]),
      ),
    ).toBe(true);
  });

  it("is false when any member ends away from its start", () => {
    expect(
      actionSequencePathIsClosed(
        sequenceOf([
          poseBlock("a", 0, pose(0), 7),
          poseBlock("b", 1000, pose(0), 7),
          poseBlock("c", 0, pose(0), 8),
          poseBlock("d", 1000, pose(50), 8),
        ]),
      ),
    ).toBe(false);
  });

  it("is false when resolve throws", () => {
    expect(
      actionSequencePathIsClosed({
        ...sequenceOf([]),
        blocks: [
          {
            id: "bad",
            kind: "static-preset",
            presetId: "not-a-preset",
            atMs: 0,
            orderedObjectIds: [7],
            params: {},
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("reconcileSequenceLoop", () => {
  it("leaves a non-looping sequence unchanged", () => {
    const sequence = sequenceOf([poseBlock("a", 0, pose(0)), poseBlock("b", 1000, pose(80))]);
    expect(reconcileSequenceLoop(sequence)).toEqual({ sequence, cleared: false });
  });

  it("keeps loop on a closed path", () => {
    const sequence = sequenceOf(
      [poseBlock("a", 0, pose(0)), poseBlock("b", 1000, pose(80)), poseBlock("c", 2000, pose(0))],
      true,
    );
    expect(reconcileSequenceLoop(sequence)).toEqual({ sequence, cleared: false });
    expect(isSequenceLooping(sequence)).toBe(true);
  });

  it("clears loop when the path is no longer closed", () => {
    const sequence = sequenceOf(
      [poseBlock("a", 0, pose(0)), poseBlock("b", 1000, pose(80))],
      true,
    );
    expect(reconcileSequenceLoop(sequence)).toEqual({
      sequence: { ...sequence, loop: false },
      cleared: true,
    });
  });

  it("treats missing loop as off", () => {
    expect(isSequenceLooping(sequenceOf([poseBlock("a", 0, pose(0))]))).toBe(false);
  });
});
