import { describe, expect, it } from "vitest";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import type { ControlledObject, CueItem } from "../timeline/timeline-data";
import { cueObjectSetsMatch } from "../timeline/timeline-data";
import { buildTransitionSequence } from "../action-builder-ops";
import {
  computeTransitionRows,
  durationMsFromSpeed,
  estimateArrivalMs,
  minFeasibleDurationMs,
} from "./transition-math";

const OBJECTS: ControlledObject[] = [
  {
    id: 1,
    name: "车台-01",
    currentPosition: 0,
    unit: "mm",
    axisLabel: "升降/旋转",
    enabled: true,
    enabledAxes: ["v1"],
    maxSpeedByAxis: { v1: 400 },
  },
  {
    id: 2,
    name: "车台-02",
    currentPosition: 0,
    unit: "mm",
    axisLabel: "升降/旋转",
    enabled: true,
    enabledAxes: ["v1", "v2"],
    maxSpeedByAxis: { v1: 500, v2: 10 },
  },
];

const lookup = (id: number) => OBJECTS.find((object) => object.id === id);

const CUE_A: CueItem = {
  id: "cue-a",
  name: "开场",
  targets: { "1": { v1: 0 }, "2": { v1: 0, v2: 0 } },
};

const CUE_B: CueItem = {
  id: "cue-b",
  name: "谢幕",
  targets: { "1": { v1: 2000 }, "2": { v1: 4000, v2: 30 } },
};

describe("transition-math", () => {
  it("computes per object/axis travel and required speed for a duration", () => {
    const rows = computeTransitionRows(CUE_A, CUE_B, 8000, lookup);
    const co1 = rows.find((row) => row.objectId === 1 && row.axis === "v1");
    const co2v1 = rows.find((row) => row.objectId === 2 && row.axis === "v1");
    const co2v2 = rows.find((row) => row.objectId === 2 && row.axis === "v2");

    expect(co1?.travel).toBe(2000);
    expect(co1?.requiredSpeed).toBeCloseTo(312.5);
    expect(co1?.exceeded).toBe(false);

    expect(co2v1?.requiredSpeed).toBeCloseTo(625);
    expect(co2v1?.exceeded).toBe(true);
    expect(co2v2?.travel).toBe(30);
  });

  it("flags exceeded axes when duration is too short", () => {
    const rows = computeTransitionRows(CUE_A, CUE_B, 2000, lookup);
    const co2v1 = rows.find((row) => row.objectId === 2 && row.axis === "v1");
    expect(co2v1?.requiredSpeed).toBeCloseTo(2500);
    expect(co2v1?.exceeded).toBe(true);
  });

  it("min feasible duration honours the slowest constrained axis", () => {
    expect(minFeasibleDurationMs(CUE_A, CUE_B, lookup)).toBe(10000);
  });

  it("ignores leftover acceleration limits when flagging exceeded and estimating duration", () => {
    const lookupTight = (id: number): ControlledObject | undefined => {
      const object = lookup(id);
      if (!object) return undefined;
      return {
        ...object,
        maxAccelerationByAxis: { v1: 1e-9, v2: 1e-9, v3: 1e-9 },
        maxDecelerationByAxis: { v1: 1e-9, v2: 1e-9, v3: 1e-9 },
      } as ControlledObject;
    };
    const rows = computeTransitionRows(CUE_A, CUE_B, 8000, lookupTight);
    const co1 = rows.find((row) => row.objectId === 1 && row.axis === "v1");
    expect(co1?.exceeded).toBe(false);
    expect(minFeasibleDurationMs(CUE_A, CUE_B, lookupTight)).toBe(10000);
  });

  it("derives duration from v1 speed (speed ↔ time interlock)", () => {
    expect(durationMsFromSpeed(CUE_A, CUE_B, 500)).toBe(8000);
    expect(durationMsFromSpeed(CUE_A, CUE_B, 0)).toBeNull();
  });

  it("estimates arrival time from current scene positions to cue targets", () => {
    expect(estimateArrivalMs(CUE_B, lookup)).toBe(8000);
    expect(estimateArrivalMs(CUE_A, lookup)).toBe(0);
    expect(estimateArrivalMs({ id: "cue-x", name: "空", targets: {} }, lookup)).toBeNull();
  });

  it("cueObjectSetsMatch requires identical object sets", () => {
    expect(cueObjectSetsMatch(CUE_A, CUE_B)).toBe(true);
    const partial: CueItem = { id: "cue-c", name: "部分", targets: { "1": { v1: 1 } } };
    expect(cueObjectSetsMatch(CUE_A, partial)).toBe(false);
  });

  it("buildTransitionSequence copies Cue poses into two timed pose blocks per object", () => {
    const durationMs = 8000;
    const fromPose = { v1: 0, v2: 0, v3: 0 };
    const toPose = { v1: 2000, v2: 0, v3: 0 };
    const sequence = buildTransitionSequence(1, CUE_A, CUE_B, durationMs);
    expect(sequence.name).toBe("开场 → 谢幕");
    expect(sequence.trajectoryMode).toBe("non-forced");
    expect(sequence).not.toHaveProperty("initialPoses");
    expect(sequence.blocks).toHaveLength(4);
    expect(sequence.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "pose", objectId: 1, atMs: 0, pose: fromPose }),
        expect.objectContaining({ kind: "pose", objectId: 1, atMs: durationMs, pose: toPose }),
        expect.objectContaining({
          kind: "pose",
          objectId: 2,
          atMs: 0,
          pose: { v1: 0, v2: 0, v3: 0 },
        }),
        expect.objectContaining({
          kind: "pose",
          objectId: 2,
          atMs: durationMs,
          pose: { v1: 4000, v2: 30, v3: 0 },
        }),
      ]),
    );
    expect(sequence.segments).toEqual([
      expect.objectContaining({
        fromRef: expect.any(String),
        toRef: expect.any(String),
        settings: { profiles: createDefaultAxisProfiles(durationMs) },
      }),
      expect.objectContaining({
        fromRef: expect.any(String),
        toRef: expect.any(String),
        settings: { profiles: createDefaultAxisProfiles(durationMs) },
      }),
    ]);
    expect(sequence.segments[0]?.settings.profiles.v1.params).not.toBe(
      sequence.segments[1]?.settings.profiles.v1.params,
    );
    for (const block of sequence.blocks) {
      expect(block.kind).toBe("pose");
      if (block.kind === "pose") {
        expect(block).not.toHaveProperty("cueId");
      }
    }
  });

  it("defaults segment profiles from minAccelTimeByAxis per object", () => {
    const lookup = (id: number): ControlledObject | undefined => {
      if (id === 1) {
        return {
          ...OBJECTS[0]!,
          minAccelTimeByAxis: { v1: 1, v2: 0.5 },
        };
      }
      return OBJECTS.find((object) => object.id === id);
    };
    const sequence = buildTransitionSequence(1, CUE_A, CUE_B, 5000, lookup);
    const objectOne = sequence.segments.find((segment) => {
      const from = sequence.blocks.find((block) => block.id === segment.fromRef);
      return from?.kind === "pose" && from.objectId === 1;
    });
    expect(objectOne?.settings.profiles.v1.params).toEqual({ accelMs: 1000, decelMs: 1000 });
    expect(objectOne?.settings.profiles.v2.params).toEqual({ accelMs: 500, decelMs: 500 });
  });
});
