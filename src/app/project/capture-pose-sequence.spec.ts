import { describe, expect, it } from "vitest";
import type { ModelPose } from "./action-sequence/types";
import { buildCapturedPoseSequence } from "./capture-pose-sequence";

const pose = (v1: number): ModelPose => ({ v1, v2: 0, v3: 0 });

describe("buildCapturedPoseSequence", () => {
  it("returns null when no object yields a pose", () => {
    expect(
      buildCapturedPoseSequence({
        id: 9,
        name: "新序列",
        objectIds: [1, 2],
        poseForObject: () => null,
      }),
    ).toBeNull();
    expect(
      buildCapturedPoseSequence({
        id: 9,
        name: "新序列",
        objectIds: [],
        poseForObject: () => pose(1),
      }),
    ).toBeNull();
  });

  it("builds one t=0 pose block per object that has a pose", () => {
    const sequence = buildCapturedPoseSequence({
      id: 12,
      name: "新序列 (2)",
      objectIds: [7, 8, 9],
      poseForObject: (id) => (id === 8 ? null : pose(id * 10)),
    });
    expect(sequence).not.toBeNull();
    expect(sequence!.id).toBe(12);
    expect(sequence!.name).toBe("新序列 (2)");
    expect(sequence!.trajectoryMode).toBe(false);
    expect(sequence!.loop).toBe(false);
    expect(sequence!.segments).toEqual([]);
    expect(sequence!.blocks).toHaveLength(2);
    expect(sequence!.blocks.every((block) => block.kind === "pose" && block.atMs === 0)).toBe(true);
    const poses = sequence!.blocks.filter((block) => block.kind === "pose");
    expect(poses.map((block) => [block.objectId, block.pose.v1])).toEqual([
      [7, 70],
      [9, 90],
    ]);
  });
});
