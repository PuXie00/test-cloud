import { describe, expect, it } from "vitest";
import { axisKinematics } from "./axis-kinematics";
import { compilePlcAction } from "./compile-plc-action";
import { createDefaultAxisProfiles } from "./motion-profile";
import type { ActionSequenceConfig, AxisMotionProfiles, DynamicPresetBlock, ModelPose, MotionProfile, TimelineBlock } from "./types";
import type { AxisLimit, VirtualAxisId } from "./validate-sequence";

const origin: ModelPose = { v1: 0, v2: 0, v3: 0 };

const trap = (accelMs: number, decelMs: number): MotionProfile => ({
  kind: "trapezoid",
  params: { accelMs, decelMs },
});

const axisProfiles = (accelMs: number, decelMs: number): AxisMotionProfiles => ({
  v1: trap(accelMs, decelMs),
  v2: trap(accelMs, decelMs),
  v3: trap(accelMs, decelMs),
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

const compileContext = (
  objects: { id: number; enabledVirtualAxes: readonly VirtualAxisId[] }[],
) => ({
  objects: objects.map((object) => ({
    ...object,
    limits: limitsFor(object.enabledVirtualAxes),
  })),
});

const sequenceOf = (
  blocks: TimelineBlock[],
  extra?: Partial<ActionSequenceConfig>,
): ActionSequenceConfig => ({
  id: 1,
  name: "Seq",
  trajectoryMode: false,
  blocks,
  segments: [],
  ...extra,
});

const threeAxisContext = compileContext(
  [{ id: 7, enabledVirtualAxes: ["v1", "v2", "v3"] as const }],
);

const laterInitialSequence: ActionSequenceConfig = sequenceOf(
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
    trajectoryMode: true,
    segments: [{
      fromRef: "first",
      toRef: "second",
      settings: { profiles: axisProfiles(400, 400) },
    }],
  },
);

describe("compilePlcAction", () => {
  it("maps v1/v2/v3 to virtualAxisNo 1/2/3 and omits disabled axes", () => {
    const compiled = compilePlcAction(
      laterInitialSequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
    );
    expect(compiled).not.toHaveProperty("checksum");
    expect(compiled).not.toHaveProperty("trajectoryMode");
    expect(compiled.timelines).toHaveLength(1);
    expect(compiled.timelines[0]?.virtualAxisNo).toBe(1);
    expect(compiled.timelines[0]?.modelId).toBe(7);
    expect(compiled.timelines[0]?.segments.length).toBeGreaterThan(0);
  });

  it("emits enableFlag io blocks", () => {
    const compiled = compilePlcAction(laterInitialSequence, threeAxisContext);
    expect(compiled.ioBlocks).toContainEqual({
      time: 500,
      params: {
        OptCmd: "Operation|enable",
        addr: "0x0102",
        params: [{ deviceId: 7, enableFlag: 0 }],
      },
    });
  });

  it("starts the first moving segment at the first pose time", () => {
    const compiled = compilePlcAction(laterInitialSequence, threeAxisContext);
    const v1 = compiled.timelines.find((timeline) => timeline.virtualAxisNo === 1);
    expect(v1?.segments[0]?.startTime).toBe(3000);
  });

  it("emits one hold row per enabled axis for a single pose", () => {
    const compiled = compilePlcAction(
      sequenceOf([{
        id: "only",
        kind: "pose",
        objectId: 7,
        atMs: 4000,
        pose: { v1: 42, v2: 1, v3: 2 },
      }]),
      threeAxisContext,
    );
    expect(compiled.timelines).toHaveLength(3);
    const byAxis = Object.fromEntries(
      compiled.timelines.map((timeline) => [timeline.virtualAxisNo, timeline.segments]),
    );
    expect(byAxis[1]).toEqual([
      { startTime: 4000, position: 42, a: 42, b: 0, c: 0, d: 0, e: 0, f: 0 },
    ]);
    expect(byAxis[2]?.[0]?.position).toBe(1);
    expect(byAxis[3]?.[0]?.position).toBe(2);
  });

  it("keeps hold-row position and sets A to the same value", () => {
    const compiled = compilePlcAction(
      sequenceOf([{
        id: "only",
        kind: "pose",
        objectId: 7,
        atMs: 4000,
        pose: { v1: 42.16, v2: 1.24, v3: 2 },
      }]),
      threeAxisContext,
    );
    const byAxis = Object.fromEntries(
      compiled.timelines.map((timeline) => [timeline.virtualAxisNo, timeline.segments[0]]),
    );
    expect(byAxis[1]).toMatchObject({ position: 42.16, a: 42.16 });
    expect(byAxis[2]).toMatchObject({ position: 1.24, a: 1.24 });
    expect(byAxis[3]).toMatchObject({ position: 2, a: 2 });
  });

  it("compiles a command-only sequence with io blocks and no timelines or models", () => {
    const compiled = compilePlcAction(
      sequenceOf([{
        id: "enable",
        kind: "instruction",
        presetId: "set-enabled",
        objectId: 7,
        atMs: 1000,
        instr: { enabled: true },
      }]),
      threeAxisContext,
    );
    expect(compiled.timelines).toEqual([]);
    expect(compiled.models).toEqual([]);
    expect(compiled.ioBlocks).toEqual([{
      time: 1000,
      params: {
        OptCmd: "Operation|enable",
        addr: "0x0102",
        params: [{ deviceId: 7, enableFlag: 1 }],
      },
    }]);
  });

  it("uses three phase rows whose startTimes match accel/cruise/decel", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 1000, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 1000, v2: 0, v3: 0 } },
      ],
      {
        segments: [{
          fromRef: "start",
          toRef: "end",
          settings: { profiles: axisProfiles(150, 250) },
        }],
      },
    );
    const compiled = compilePlcAction(
      sequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
    );
    const segments = compiled.timelines[0]?.segments ?? [];
    expect(segments).toHaveLength(4);
    expect(segments[0]?.startTime).toBe(1000);
    expect(segments[1]?.startTime).toBe(1150);
    expect(segments[2]?.startTime).toBe(1750);
    expect(segments[3]).toEqual({
      startTime: 2000,
      position: 1000,
      a: 1000,
      b: 0,
      c: 0,
      d: 0,
      e: 0,
      f: 0,
    });
  });

  it("matches the model-6 PLC polynomial for 0-1000-0 over 20000ms", () => {
    const idle = { kind: "idle" as const };
    const moving = trap(1000, 1000);
    const profiles = { v1: moving, v2: idle, v3: idle };
    const sequence = sequenceOf(
      [
        { id: "a", kind: "pose", objectId: 6, atMs: 0, pose: origin },
        { id: "b", kind: "pose", objectId: 6, atMs: 10000, pose: { v1: 1000, v2: 0, v3: 0 } },
        { id: "c", kind: "pose", objectId: 6, atMs: 20000, pose: origin },
      ],
      {
        segments: [
          { fromRef: "a", toRef: "b", settings: { profiles } },
          { fromRef: "b", toRef: "c", settings: { profiles } },
        ],
      },
    );
    const compiled = compilePlcAction(
      sequence,
      compileContext([{ id: 6, enabledVirtualAxes: ["v1", "v2", "v3"] as const }]),
    );
    expect(compiled.totalDuration).toBe(20000);
    const byAxis = Object.fromEntries(
      compiled.timelines.map((timeline) => [timeline.virtualAxisNo, timeline.segments]),
    );
    const h = byAxis[1] ?? [];
    expect(h).toHaveLength(7);
    expect(h.map((row) => row.startTime)).toEqual([0, 1000, 9000, 10000, 11000, 19000, 20000]);
    expect(h[0]?.c).toBeCloseTo(0.5555556, 6);
    expect(h[1]?.position).toBeCloseTo(55.5555556, 6);
    expect(h[1]?.a).toBe(h[1]?.position);
    expect(h[1]?.b).toBeCloseTo(11.1111111, 6);
    expect(h[2]?.position).toBeCloseTo(944.4444444, 6);
    expect(h[2]?.b).toBeCloseTo(11.1111111, 6);
    expect(h[2]?.c).toBeCloseTo(-0.5555556, 6);
    expect(h[3]).toMatchObject({ position: 1000, a: 1000, b: 0 });
    expect(h[3]?.c).toBeCloseTo(-0.5555556, 6);
    expect(h[4]?.position).toBeCloseTo(944.4444444, 6);
    expect(h[4]?.b).toBeCloseTo(-11.1111111, 6);
    expect(h[5]?.position).toBeCloseTo(55.5555556, 6);
    expect(h[5]?.b).toBeCloseTo(-11.1111111, 6);
    expect(h[5]?.c).toBeCloseTo(0.5555556, 6);
    expect(h[6]).toMatchObject({ position: 0, a: 0, b: 0, c: 0 });
    for (const axis of [2, 3]) {
      expect(byAxis[axis]).toEqual([
        { startTime: 0, position: 0, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 },
        { startTime: 20000, position: 0, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 },
      ]);
    }
  });

  it("throws when a timeline exceeds 100 segments", () => {
    const poseCount = 36;
    const blocks = Array.from({ length: poseCount }, (_, index) => ({
      id: `p${index}`,
      kind: "pose" as const,
      objectId: 7,
      atMs: index * 1000,
      pose: { v1: index, v2: 0, v3: 0 },
    }));
    const segments = Array.from({ length: poseCount - 1 }, (_, index) => ({
      fromRef: `p${index}`,
      toRef: `p${index + 1}`,
      settings: { profiles: axisProfiles(200, 200) },
    }));
    expect(() =>
      compilePlcAction(
        sequenceOf(blocks, { segments }),
        compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
      ),
    ).toThrow(/100/);
  });

  it("emits one C++ time block per pose with arriving-segment absolute kinematics", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 1000, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 1000, v2: 0, v3: 0 } },
      ],
      {
        segments: [{
          fromRef: "start",
          toRef: "end",
          settings: { profiles: axisProfiles(150, 250) },
        }],
      },
    );
    const compiled = compilePlcAction(
      sequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
    );
    const expected = axisKinematics(trap(150, 250), 1000, 1000);
    expect(compiled.models).toEqual([{
      deviceId: 7,
      timeBlockList: [
        { time: 1000, virtualAxis: [{ pos: 0, vel: 0, accVel: 0, decVel: 0 }] },
        { time: 2000, virtualAxis: [{ pos: 1000, ...expected }] },
      ],
    }]);
  });

  it("writes the same kinematics on the interval start when requested", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 1000, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 1000, v2: 0, v3: 0 } },
      ],
      {
        segments: [{
          fromRef: "start",
          toRef: "end",
          settings: { profiles: axisProfiles(150, 250) },
        }],
      },
    );
    const compiled = compilePlcAction(
      sequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
      true,
    );
    const expected = axisKinematics(trap(150, 250), 1000, 1000);
    expect(compiled.models).toEqual([{
      deviceId: 7,
      timeBlockList: [
        { time: 1000, virtualAxis: [{ pos: 0, ...expected }] },
        { time: 2000, virtualAxis: [{ pos: 1000, vel: 0, accVel: 0, decVel: 0 }] },
      ],
    }]);
  });

  it("omits disabled axes from C++ virtualAxis", () => {
    const compiled = compilePlcAction(
      laterInitialSequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
    );
    expect(compiled.models[0]?.timeBlockList[0]?.virtualAxis).toHaveLength(1);
  });

  it("includes invisible wave hold poses as zero-kinematics blocks", () => {
    const wave: DynamicPresetBlock = {
      id: "wave-1",
      kind: "dynamic-preset",
      presetId: "dynamic-wave",
      startMs: 1000,
      endMs: 3000,
      orderedObjectIds: [7, 8],
      params: {
        baseV1: 1000,
        amplitude: 500,
        cycles: 1,
        direction: 1,
        staggerMs: 500,
        v2: 0,
        v3: 0,
      },
      profiles: createDefaultAxisProfiles(750),
    };
    const compiled = compilePlcAction(
      sequenceOf([wave]),
      compileContext([
        { id: 7, enabledVirtualAxes: ["v1"] as const },
        { id: 8, enabledVirtualAxes: ["v1"] as const },
      ]),
    );
    const model7 = compiled.models.find((model) => model.deviceId === 7);
    expect(model7?.timeBlockList.map((block) => block.time)).toEqual([1000, 1750, 2500, 3000]);
    expect(model7?.timeBlockList[0]?.virtualAxis).toEqual([
      { pos: 1000, vel: 0, accVel: 0, decVel: 0 },
    ]);
    expect(model7?.timeBlockList[3]?.virtualAxis).toEqual([
      { pos: 1000, vel: 0, accVel: 0, decVel: 0 },
    ]);
    const model8 = compiled.models.find((model) => model.deviceId === 8);
    expect(model8?.timeBlockList[0]).toEqual({
      time: 1000,
      virtualAxis: [{ pos: 1000, vel: 0, accVel: 0, decVel: 0 }],
    });
  });

  it("throws when compiling an unsupported C++ motion profile", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 10, v2: 0, v3: 0 } },
      ],
      {
        segments: [{
          fromRef: "start",
          toRef: "end",
          settings: {
            profiles: {
              v1: { kind: "cubic" } as unknown as MotionProfile,
              v2: { kind: "idle" },
              v3: { kind: "idle" },
            },
          },
        }],
      },
    );
    expect(() =>
      compilePlcAction(
        sequence,
        compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
      ),
    ).toThrow(/unsupported motion profile: cubic|sequence has blocking validation issues/);
  });
});
