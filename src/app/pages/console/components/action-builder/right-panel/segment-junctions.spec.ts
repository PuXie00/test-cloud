import { describe, expect, it } from "vitest";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig, PoseBlock } from "@/app/project/action-sequence/types";
import { PRESET_POINT_TEXT, endJunctionView, withAxisPassSpeed, withEndStop } from "./segment-junctions";

const sequenceOf = (blocks: PoseBlock[]): ActionSequenceConfig => ({
  id: 1,
  name: "s",
  trajectoryMode: false,
  blocks,
  segments: [],
});

const pose = (id: string, atMs: number, v1: number, extra: Partial<PoseBlock> = {}): PoseBlock => ({
  id,
  kind: "pose",
  objectId: 1,
  atMs,
  pose: { v1 },
  ...extra,
});

const pointOf = (sequence: ActionSequenceConfig, ref: string) =>
  resolveActionSequence(sequence).poses.find((point) => point.sourceRef === ref);

describe("endJunctionView", () => {
  // 0 → 200 → 400 一路往上：中间不停，两头是序列的开头和结尾
  const rising = sequenceOf([pose("a", 0, 0), pose("b", 2000, 200), pose("c", 4000, 400)]);

  it("offers stop or continue in the middle of a run, continuing by default", () => {
    expect(endJunctionView(pointOf(rising, "b"), ["v1"], "end")).toEqual({
      kind: "choice",
      axes: ["v1"],
      stop: false,
    });
  });

  it("shows a stop typed as 0 as stopping", () => {
    const stopped = sequenceOf([
      pose("a", 0, 0),
      pose("b", 2000, 200, { passSpeeds: { v1: 0 } }),
      pose("c", 4000, 400),
    ]);
    expect(endJunctionView(pointOf(stopped, "b"), ["v1"], "start")).toMatchObject({ stop: true });
  });

  it("explains the ends of the object's run instead of offering a choice", () => {
    expect(endJunctionView(pointOf(rising, "a"), ["v1"], "start")).toEqual({
      kind: "fixed",
      text: "开头，从静止起步",
    });
    expect(endJunctionView(pointOf(rising, "c"), ["v1"], "end")).toEqual({
      kind: "fixed",
      text: "结尾，停在这里",
    });
  });

  it("explains a reversal", () => {
    const back = sequenceOf([pose("a", 0, 0), pose("b", 2000, 400), pose("c", 4000, 0)]);
    expect(endJunctionView(pointOf(back, "b"), ["v1"], "end")).toEqual({
      kind: "fixed",
      text: "方向相反，在这里停",
    });
  });

  it("calls axes that disagree mixed", () => {
    const point = {
      ...pointOf(rising, "b")!,
      junctions: {
        v1: { kind: "auto" as const, speed: 120 },
        v2: { kind: "manual" as const, speed: 0 },
      },
    };
    expect(endJunctionView(point, ["v1", "v2"], "end")).toEqual({
      kind: "choice",
      axes: ["v1", "v2"],
      stop: "mixed",
    });
  });

  it("sends preset key points to the preset", () => {
    const point = { ...pointOf(rising, "b")!, sourceKind: "static-preset" as const };
    expect(endJunctionView(point, ["v1"], "end")).toEqual({ kind: "fixed", text: PRESET_POINT_TEXT });
  });

  it("has nothing to say for axes not set on that pose", () => {
    expect(endJunctionView(pointOf(rising, "b"), ["v2"], "end")).toEqual({ kind: "none" });
  });
});

describe("pass speed writes", () => {
  const block = pose("b", 2000, 200, { passSpeeds: { v1: 150 } });

  it("stops every given axis", () => {
    expect(withEndStop(block, ["v1"], true).passSpeeds).toEqual({ v1: 0 });
  });

  it("continues by dropping only the typed stops", () => {
    const mixed = { ...block, passSpeeds: { v1: 0, v2: 150 } };
    expect(withEndStop(mixed, ["v1", "v2"], false).passSpeeds).toEqual({ v2: 150 });
    expect("passSpeeds" in withEndStop({ ...block, passSpeeds: { v1: 0 } }, ["v1"], false)).toBe(false);
  });

  it("types one axis's speed or puts it back to automatic", () => {
    expect(withAxisPassSpeed(block, "v1", 80).passSpeeds).toEqual({ v1: 80 });
    expect("passSpeeds" in withAxisPassSpeed(block, "v1", null)).toBe(false);
  });
});
