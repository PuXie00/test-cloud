import { describe, expect, it } from "vitest";
import { compilePlcAction } from "./compile-plc-action";
import { createDefaultAxisProfiles } from "./motion-profile";
import { toActionDataSaveItems } from "./plc-action-payload";
import type { ActionSequenceConfig, TimelineBlock } from "./types";

const sequenceOf = (
  blocks: TimelineBlock[],
  extra?: Partial<ActionSequenceConfig>,
): ActionSequenceConfig => ({
  id: "seq",
  name: "Seq",
  trajectoryMode: "non-forced",
  blocks,
  segments: [],
  ...extra,
});

const context = {
  objects: [{
    id: 7,
    enabledVirtualAxes: ["v1", "v2", "v3"] as const,
    limits: {
      v1: {
        min: -1_000_000,
        max: 1_000_000,
        maxVelocity: 1_000_000,
        maxAcceleration: 1_000_000,
        maxDeceleration: 1_000_000,
        minAccelTime: 0.2,
      },
    },
  }],
  sampleIntervalMs: 20,
};

const sequence: ActionSequenceConfig = sequenceOf(
  [
    {
      id: "first",
      kind: "pose",
      objectId: 7,
      atMs: 3000,
      pose: { v1: 30, v2: 0, v3: 0 },
    },
    {
      id: "second",
      kind: "pose",
      objectId: 7,
      atMs: 5000,
      pose: { v1: 50, v2: 0, v3: 0 },
    },
    { id: "disable", kind: "set-enabled", objectId: 7, atMs: 500, enabled: false },
  ],
  {
    trajectoryMode: "forced",
    segments: [{
      fromRef: "first",
      toRef: "second",
      settings: { profiles: createDefaultAxisProfiles(2000) },
    }],
  },
);

describe("toActionDataSaveItems", () => {
  it("maps arrays, counts, and trajectoryMode without separate initial-pose fields", () => {
    const compiled = compilePlcAction(sequence, context);
    const items = toActionDataSaveItems(compiled);
    expect(items[0].trajectoryMode).toBe("forced");
    expect(items[0].trajectoryMode).toBe(compiled.trajectoryMode);
    expect(items[0].checksum).toBe(compiled.checksum);
    expect(items[0].timelineCount).toBe(compiled.timelines.length);
    expect(items[0].timelineList[0].pointCount).toBe(items[0].timelineList[0].timeArray.length);
    expect(items[0].eventCount).toBe(compiled.events.length);
    expect(items[0].eventList).toEqual(compiled.events);
    expect(items[0]).not.toHaveProperty("initialPoseCount");
    expect(items[0]).not.toHaveProperty("initialPoseList");
  });

  it("maps a command-only compile to events and zero timelines", () => {
    const compiled = compilePlcAction(
      sequenceOf([{ id: "enable", kind: "set-enabled", objectId: 7, atMs: 1000, enabled: true }]),
      context,
    );
    const items = toActionDataSaveItems(compiled);
    expect(items[0].timelineCount).toBe(0);
    expect(items[0].timelineList).toEqual([]);
    expect(items[0].eventCount).toBe(1);
    expect(items[0].eventList).toEqual([
      { modelNo: 7, atMs: 1000, kind: "set-enabled", enabled: true },
    ]);
  });
});
