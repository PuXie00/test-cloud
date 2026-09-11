import { describe, expect, it } from "vitest";
import { compilePlcAction } from "./compile-plc-action";
import { createDefaultAxisProfiles } from "./motion-profile";
import { toActionDataSaveItems } from "./plc-action-payload";
import type { ActionSequenceConfig, TimelineBlock } from "./types";
import type { AxisLimit, VirtualAxisId } from "./validate-sequence";

const sequenceOf = (
  blocks: TimelineBlock[],
  extra?: Partial<ActionSequenceConfig>,
): ActionSequenceConfig => ({
  id: 1,
  name: "Seq",
  trajectoryMode: "non-forced",
  blocks,
  segments: [],
  ...extra,
});

const unlimitedAxis = (): AxisLimit => ({
  min: -1_000_000,
  max: 1_000_000,
  maxVelocity: 1_000_000,
  minAccelTime: 0.001,
});

const limitsFor = (axes: readonly VirtualAxisId[]) =>
  Object.fromEntries(axes.map((axis) => [axis, unlimitedAxis()])) as Partial<
    Record<VirtualAxisId, AxisLimit>
  >;

const context = {
  objects: [{
    id: 7,
    enabledVirtualAxes: ["v1", "v2", "v3"] as const,
    limits: limitsFor(["v1", "v2", "v3"]),
  }],
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
    { id: "disable", kind: "instruction",
      presetId: "set-enabled", objectId: 7, atMs: 500, instr: { enabled: false } },
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
  it("fills actionId, counts, curve segments, and enableFlag events", () => {
    const compiled = compilePlcAction(sequence, context);
    const items = toActionDataSaveItems(compiled, 7);
    const item = items[0];
    expect(item.actionId).toBe(7);
    expect(item).not.toHaveProperty("actionNo");
    expect(item).not.toHaveProperty("checksum");
    expect(item).not.toHaveProperty("trajectoryMode");
    expect(item.timelineCount).toBe(compiled.timelines.length);
    expect(item.timelineList[0]?.modelId).toBe(7);
    expect(item.timelineList[0]?.virtualAxisNo).toBe(1);
    expect(item.timelineList[0]?.segmentCount).toBe(item.timelineList[0]?.segmentList.length);
    expect(item.eventCount).toBe(1);
    expect(item.eventList).toEqual([{ modelId: 7, atTime: 500, enableFlag: 0 }]);
  });

  it("maps a command-only compile to events and zero timelines", () => {
    const compiled = compilePlcAction(
      sequenceOf([{
        id: "enable",
        kind: "instruction",
        presetId: "set-enabled",
        objectId: 7,
        atMs: 1000,
        instr: { enabled: true },
      }]),
      context,
    );
    const items = toActionDataSaveItems(compiled, 3);
    expect(items[0].actionId).toBe(3);
    expect(items[0].timelineCount).toBe(0);
    expect(items[0].timelineList).toEqual([]);
    expect(items[0].eventList).toEqual([{ modelId: 7, atTime: 1000, enableFlag: 1 }]);
  });
});
