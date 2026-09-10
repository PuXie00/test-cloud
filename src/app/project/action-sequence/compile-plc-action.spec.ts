import { describe, expect, it } from "vitest";
import { compilePlcAction } from "./compile-plc-action";
import { evaluateResolvedSequence } from "./evaluate-sequence";
import { resolveActionSequence } from "./resolve-sequence";
import type { ActionSequenceConfig, AxisMotionProfiles, ModelPose, MotionProfile, TimelineBlock } from "./types";
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
  maxAcceleration: 1_000_000,
  maxDeceleration: 1_000_000,
});

const limitsFor = (axes: readonly VirtualAxisId[]) =>
  Object.fromEntries(axes.map((axis) => [axis, unlimitedAxis()])) as Partial<
    Record<VirtualAxisId, AxisLimit>
  >;

const compileContext = (
  objects: { id: number; enabledVirtualAxes: readonly VirtualAxisId[] }[],
  sampleIntervalMs: number,
) => ({
  objects: objects.map((object) => ({
    ...object,
    limits: limitsFor(object.enabledVirtualAxes),
  })),
  sampleIntervalMs,
});

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

const threeAxisContext = compileContext(
  [{ id: 7, enabledVirtualAxes: ["v1", "v2", "v3"] as const }],
  20,
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
    { id: "disable", kind: "set-enabled", objectId: 7, atMs: 500, enabled: false },
  ],
  {
    trajectoryMode: "forced",
    segments: [{
      fromRef: "first",
      toRef: "second",
      settings: { profiles: axisProfiles(400, 400) },
    }],
  },
);

describe("compilePlcAction", () => {
  it("keeps the first pose time and passes trajectoryMode without a synthetic zero", () => {
    const compiled = compilePlcAction(laterInitialSequence, threeAxisContext);
    expect(compiled.trajectoryMode).toBe("forced");
    expect(compiled.timelines[0]?.timeArray[0]).toBe(3000);
    expect(compiled.timelines[0]?.timeArray).not.toContain(0);
    expect(compiled.events).toContainEqual({
      modelNo: 7,
      atMs: 500,
      kind: "set-enabled",
      enabled: false,
    });
  });

  it("keeps an authored initial pose at 0ms", () => {
    const compiled = compilePlcAction(
      sequenceOf(
        [
          { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: origin },
          { id: "end", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 1000, v2: 0, v3: 0 } },
        ],
        {
          segments: [{
            fromRef: "start",
            toRef: "end",
            settings: { profiles: axisProfiles(200, 200) },
          }],
        },
      ),
      threeAxisContext,
    );
    expect(compiled.timelines[0]?.timeArray[0]).toBe(0);
    expect(compiled.timelines[0]?.timeArray).toContain(0);
  });

  it("samples different models from their own first pose times", () => {
    const compiled = compilePlcAction(
      sequenceOf([
        { id: "a", kind: "pose", objectId: 7, atMs: 1000, pose: origin },
        { id: "b", kind: "pose", objectId: 8, atMs: 2500, pose: origin },
      ]),
      compileContext(
        [
          { id: 7, enabledVirtualAxes: ["v1"] as const },
          { id: 8, enabledVirtualAxes: ["v1"] as const },
        ],
        20,
      ),
    );
    const timesFor = (modelNo: number) =>
      compiled.timelines.find((timeline) => timeline.modelNo === modelNo)?.timeArray ?? [];
    expect(timesFor(7)[0]).toBe(1000);
    expect(timesFor(8)[0]).toBe(2500);
    expect(timesFor(7)).not.toContain(0);
    expect(timesFor(8)).not.toContain(0);
  });

  it("emits a single-pose timeline at exactly the authored time", () => {
    const compiled = compilePlcAction(
      sequenceOf([
        {
          id: "only",
          kind: "pose",
          objectId: 7,
          atMs: 4000,
          pose: { v1: 42, v2: 1, v3: 2 },
        },
      ]),
      threeAxisContext,
    );
    expect(compiled.timelines).toHaveLength(3);
    for (const timeline of compiled.timelines) {
      expect(timeline.timeArray).toEqual([4000]);
    }
    expect(compiled.timelines[0]?.positionArray).toEqual([42]);
  });

  it("compiles a command-only sequence with events and no timelines", () => {
    const compiled = compilePlcAction(
      sequenceOf([{ id: "enable", kind: "set-enabled", objectId: 7, atMs: 1000, enabled: true }]),
      threeAxisContext,
    );
    expect(compiled.timelines).toEqual([]);
    expect(compiled.events).toEqual([
      { modelNo: 7, atMs: 1000, kind: "set-enabled", enabled: true },
    ]);
  });

  it("changes checksum when only trajectoryMode changes", () => {
    const blocks: TimelineBlock[] = [
      { id: "pose", kind: "pose", objectId: 7, atMs: 1000, pose: origin },
    ];
    const forced = compilePlcAction(sequenceOf(blocks, { trajectoryMode: "forced" }), threeAxisContext);
    const nonForced = compilePlcAction(
      sequenceOf(blocks, { trajectoryMode: "non-forced" }),
      threeAxisContext,
    );
    expect(forced.checksum).not.toBe(nonForced.checksum);
  });

  it("produces a stable checksum independent of block insertion order", () => {
    const reordered: ActionSequenceConfig = {
      ...laterInitialSequence,
      blocks: [...laterInitialSequence.blocks].reverse(),
    };
    expect(compilePlcAction(laterInitialSequence, threeAxisContext).checksum).toBe(
      compilePlcAction(reordered, threeAxisContext).checksum,
    );
  });

  it("includes exact trapezoid phase-boundary times matching preview evaluation", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 1000, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 1000, v2: 0, v3: 0 } },
      ],
      {
        segments: [{
          fromRef: "start",
          toRef: "end",
          settings: {
            profiles: axisProfiles(150, 250),
          },
        }],
      },
    );
    const compiled = compilePlcAction(
      sequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1", "v2", "v3"] as const }], 80),
    );
    const resolved = resolveActionSequence(sequence);
    const axisByType = ["v1", "v2", "v3"] as const;

    expect(compiled.timelines).toHaveLength(3);
    for (const timeline of compiled.timelines) {
      expect(timeline.timeArray).toContain(1150);
      expect(timeline.timeArray).toContain(1750);
      expect(timeline.timeArray).toEqual([...timeline.timeArray].sort((left, right) => left - right));
      expect(new Set(timeline.timeArray).size).toBe(timeline.timeArray.length);

      const axis = axisByType[timeline.virtualAxisType];
      const at1150 = timeline.timeArray.indexOf(1150);
      const at1750 = timeline.timeArray.indexOf(1750);
      expect(timeline.positionArray[at1150]).toBe(
        evaluateResolvedSequence(resolved, 1150).get(7)?.[axis],
      );
      expect(timeline.positionArray[at1750]).toBe(
        evaluateResolvedSequence(resolved, 1750).get(7)?.[axis],
      );
    }
  });

  it("keeps non-integer phase-boundary sample times without rounding", () => {
    const startMs = 1000;
    const durationMs = 333;
    const accelMs = 0.15 * durationMs;
    const decelMs = 0.25 * durationMs;
    const accelAt = startMs + durationMs * (accelMs / durationMs);
    const decelAt = startMs + durationMs * (1 - decelMs / durationMs);
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: startMs, pose: origin },
        {
          id: "end",
          kind: "pose",
          objectId: 7,
          atMs: startMs + durationMs,
          pose: { v1: 1000, v2: 0, v3: 0 },
        },
      ],
      {
        segments: [{
          fromRef: "start",
          toRef: "end",
          settings: {
            profiles: axisProfiles(accelMs, decelMs),
          },
        }],
      },
    );
    const compiled = compilePlcAction(
      sequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }], 20),
    );
    const timeline = compiled.timelines[0];
    expect(Number.isInteger(accelAt)).toBe(false);
    expect(Number.isInteger(decelAt)).toBe(false);
    expect(timeline?.timeArray).toContain(accelAt);
    expect(timeline?.timeArray).toContain(decelAt);
    expect(timeline?.timeArray).toEqual(
      [...(timeline?.timeArray ?? [])].sort((left, right) => left - right),
    );
    expect(new Set(timeline?.timeArray).size).toBe(timeline?.timeArray.length);
  });

  it("unions per-axis phase-boundary times when accel times differ", () => {
    const startMs = 1000;
    const durationMs = 1000;
    const profiles: AxisMotionProfiles = {
      v1: trap(100, 200),
      v2: trap(400, 200),
      v3: trap(200, 200),
    };
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: startMs, pose: origin },
        {
          id: "end",
          kind: "pose",
          objectId: 7,
          atMs: startMs + durationMs,
          pose: { v1: 1000, v2: 1000, v3: 0 },
        },
      ],
      {
        segments: [{ fromRef: "start", toRef: "end", settings: { profiles } }],
      },
    );
    const compiled = compilePlcAction(
      sequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1", "v2", "v3"] as const }], 80),
    );
    const v1AccelAt = startMs + 100;
    const v2AccelAt = startMs + 400;
    const sharedDecelAt = startMs + durationMs - 200;
    for (const timeline of compiled.timelines) {
      expect(timeline.timeArray).toContain(v1AccelAt);
      expect(timeline.timeArray).toContain(v2AccelAt);
      expect(timeline.timeArray).toContain(sharedDecelAt);
    }
  });
});
