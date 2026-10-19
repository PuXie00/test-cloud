import { describe, expect, it } from "vitest";
import type { ActionSequenceConfig, PoseBlock } from "@/app/project/action-sequence/types";
import type { ControlledObjectSnapshot } from "../monitor-grid/monitor-data";
import type { DimensionParticipant } from "../right-tab-panel/manual-control-tab/dimension-edit";
import {
  buildPoseGoBindings,
  captureLabel,
  livePoseLabel,
  resolveLivePoseSelection,
} from "./live-pose-edit";

const pose = (id: string, objectId: number, atMs: number, value: PoseBlock["pose"]): PoseBlock => ({
  id,
  kind: "pose",
  objectId,
  atMs,
  pose: value,
});

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: false,
  blocks: [
    pose("a", 7, 4000, { v1: 400 }),
    pose("b", 8, 4000, { v1: 500, v2: 10 }),
    pose("c", 7, 6000, { v1: 600 }),
    { id: "on", kind: "instruction", presetId: "set-enabled", objectId: 7, atMs: 0, instr: { enabled: true } },
  ],
  segments: [],
};

const participant = (
  objectId: number,
  positions: ControlledObjectSnapshot["positions"],
  axes: DimensionParticipant["axes"],
  ranges: DimensionParticipant["ranges"] = {},
): DimensionParticipant => ({
  objectId: String(objectId),
  snapshot: { positions } as ControlledObjectSnapshot,
  axes,
  unitByAxis: {},
  ranges,
});

describe("resolveLivePoseSelection", () => {
  it("takes the selected poses, one per object", () => {
    expect(resolveLivePoseSelection(sequence, { kind: "multi-block", blockIds: ["a", "b", "on"] })).toEqual({
      kind: "poses",
      poses: [sequence.blocks[0], sequence.blocks[1]],
    });
    expect(resolveLivePoseSelection(sequence, { kind: "block", blockId: "on" })).toEqual({ kind: "none" });
    expect(resolveLivePoseSelection(sequence, null)).toEqual({ kind: "none" });
    expect(resolveLivePoseSelection(null, { kind: "block", blockId: "a" })).toEqual({ kind: "none" });
  });

  it("refuses two poses of the same object", () => {
    expect(resolveLivePoseSelection(sequence, { kind: "multi-block", blockIds: ["a", "c"] })).toEqual({
      kind: "conflict",
    });
  });
});

describe("buildPoseGoBindings", () => {
  it("targets the set axes and holds the others at the current position, within range", () => {
    const bindings = buildPoseGoBindings(
      [pose("a", 7, 4000, { v1: 9000 }), pose("b", 8, 4000, { v2: 10 }), pose("x", 9, 0, { v1: 1 })],
      [
        participant(7, { h: 120, p: 4 }, ["v1"], { v1: { min: 0, max: 8000 } }),
        participant(8, { h: 300, p: 2 }, ["v1", "v2"]),
      ],
    );
    expect([...bindings]).toEqual([
      ["7", { target: { v1: 8000 }, current: { v1: 120, v2: 4 } }],
      ["8", { target: { v1: 300, v2: 10 }, current: { v1: 300, v2: 2 } }],
    ]);
  });
});

describe("labels", () => {
  const [a, b, c] = sequence.blocks as PoseBlock[];

  it("names the poses being edited live", () => {
    expect(livePoseLabel([a!])).toBe("联机编辑 4.0 s 的位姿");
    expect(livePoseLabel([a!, b!])).toBe("联机编辑 4.0 s 的 2 个位姿");
    expect(livePoseLabel([b!, c!])).toBe("联机编辑 2 个位姿");
  });

  it("says where 取当前 writes", () => {
    expect(captureLabel({ kind: "poses", poses: [a!] }, sequence, 0)).toBe("取当前 → 更新位姿");
    expect(captureLabel({ kind: "poses", poses: [a!, b!] }, sequence, 0)).toBe("取当前 → 更新 2 个位姿");
    expect(captureLabel({ kind: "none" }, sequence, 2500)).toBe("取当前 → 写入 2.5 s");
    expect(captureLabel({ kind: "none" }, null, 0)).toBe("取当前 → 新建动作序列");
  });
});
