import { describe, expect, it } from "vitest";
import type {
  ActionSequenceConfig,
  AxisMotionProfiles,
  ModelPose,
  MotionProfile,
  TimelineBlock,
} from "./types";
import {
  LONG_IDLE_MS,
  hasBlockingSequenceIssues,
  invalidTimelineTargets,
  validateActionSequence,
  type SequenceValidationContext,
} from "./validate-sequence";

const origin: ModelPose = { v1: 0, v2: 0, v3: 0 };

const trapezoid = (accelMs = 600, decelMs = 600): MotionProfile => ({
  kind: "trapezoid",
  params: { accelMs, decelMs },
});

const axisProfiles = (accelMs = 600, decelMs = 600): AxisMotionProfiles => ({
  v1: trapezoid(accelMs, decelMs),
  v2: trapezoid(accelMs, decelMs),
  v3: trapezoid(accelMs, decelMs),
});

const ctx = (
  objects: SequenceValidationContext["objects"] = [
    { id: 7, enabledVirtualAxes: ["v1"], limits: { v1: { min: -1000, max: 1000 } } },
  ],
): SequenceValidationContext => ({ objects });

const twoObjects = (): SequenceValidationContext =>
  ctx([
    { id: 7, enabledVirtualAxes: ["v1"], limits: {} },
    { id: 8, enabledVirtualAxes: ["v1"], limits: {} },
  ]);

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

const codesOf = (sequence: ActionSequenceConfig, context = ctx()) =>
  validateActionSequence(sequence, context).map((issue) => issue.code);

const contextWith = (limits: {
  maxVelocity?: number;
  minAccelTime?: number;
} = {}): SequenceValidationContext =>
  ctx([
    {
      id: 7,
      enabledVirtualAxes: ["v1"],
      limits: {
        v1: {
          min: -10_000,
          max: 10_000,
          maxVelocity: 10_000,
          minAccelTime: 0.5,
          ...limits,
        },
      },
    },
  ]);

const travel900 = (profiles: AxisMotionProfiles = axisProfiles()): ActionSequenceConfig =>
  sequenceOf(
    [
      { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: origin },
      { id: "end", kind: "pose", objectId: 7, atMs: 3000, pose: { v1: 900, v2: 0, v3: 0 } },
    ],
    {
      segments: [{ fromRef: "start", toRef: "end", settings: { profiles } }],
    },
  );

describe("validateActionSequence", () => {
  it("allows command-only sequences without warnings", () => {
    expect(codesOf(sequenceOf([
      { id: "enable", kind: "instruction",
      presetId: "set-enabled", objectId: 7, atMs: 1000, instr: { enabled: true } },
    ]))).toEqual([]);
  });

  it("blocks an unknown instruction presetId", () => {
    expect(codesOf(sequenceOf([
      {
        id: "x",
        kind: "instruction",
        presetId: "nope",
        objectId: 7,
        atMs: 0,
        instr: { enabled: true },
      } as never,
    ]))).toContain("unknown-instruction");
  });

  it("blocks invalid set-enabled instr", () => {
    expect(codesOf(sequenceOf([
      {
        id: "x",
        kind: "instruction",
        presetId: "set-enabled",
        objectId: 7,
        atMs: 0,
        instr: { enabled: true, extra: 1 },
      } as never,
    ]))).toContain("invalid-instruction");
  });

  it("does not treat a timed first pose as missing-initial-pose", () => {
    expect(codesOf(sequenceOf([
      { id: "pose", kind: "pose", objectId: 7, atMs: 3000, pose: origin },
    ]))).not.toContain("missing-initial-pose");
  });

  it("blocks an invalid trajectoryMode", () => {
    expect(codesOf(sequenceOf([], { trajectoryMode: "invalid" as never })))
      .toContain("invalid-trajectory-mode");
  });

  it("blocks negative authored times", () => {
    expect(codesOf(sequenceOf([
      { id: "pose", kind: "pose", objectId: 7, atMs: -1, pose: origin },
    ]))).toContain("invalid-time");
  });

  it("blocks contradictory enable events", () => {
    const issues = validateActionSequence(
      sequenceOf([
        { id: "a", kind: "instruction",
      presetId: "set-enabled", objectId: 7, atMs: 500, instr: { enabled: true } },
        { id: "b", kind: "instruction",
      presetId: "set-enabled", objectId: 7, atMs: 500, instr: { enabled: false } },
      ]),
      ctx([{ id: 7, enabledVirtualAxes: ["v1"], limits: {} }]),
    );
    expect(issues.some((issue) => issue.code === "command-conflict")).toBe(true);
  });

  it("blocks missing objects", () => {
    const issues = validateActionSequence(
      sequenceOf([{ id: "pose", kind: "pose", objectId: 99, atMs: 1000, pose: origin }]),
      ctx(),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: "error", code: "missing-object", objectId: 99 }),
    );
  });

  it("does not treat disabled axes as validated motion axes", () => {
    const issues = validateActionSequence(
      sequenceOf([{ id: "pose", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 10, v2: 999, v3: 999 } }]),
      ctx([{ id: 7, enabledVirtualAxes: ["v1"], limits: { v1: { min: 0, max: 100 } } }]),
    );
    expect(issues.some((issue) => issue.code === "limit-exceeded")).toBe(false);
  });

  it("does not throw for an unknown preset and reports invalid-preset", () => {
    const unknown = sequenceOf([
      {
        id: "p1",
        kind: "static-preset",
        presetId: "not-a-preset",
        atMs: 1000,
        orderedObjectIds: [7, 8],
        params: { v1: 0, v2: 0, v3: 0 },
      },
    ]);
    expect(() => validateActionSequence(unknown, twoObjects())).not.toThrow();
    const issues = validateActionSequence(unknown, twoObjects());
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: "error", code: "invalid-preset", blockId: "p1" }),
    );
  });

  it("blocks kind mismatch, duplicate participants, and invalid params without throwing", () => {
    const mismatch = validateActionSequence(
      sequenceOf([
        {
          id: "kind",
          kind: "dynamic-preset",
          presetId: "static-flat",
          startMs: 0,
          endMs: 1000,
          orderedObjectIds: [7, 8],
          params: { v1: 0, v2: 0, v3: 0 },
          profiles: axisProfiles(),
        },
      ]),
      twoObjects(),
    );
    const duplicates = validateActionSequence(
      sequenceOf([
        {
          id: "dup",
          kind: "static-preset",
          presetId: "static-flat",
          atMs: 1000,
          orderedObjectIds: [7, 7],
          params: { v1: 0, v2: 0, v3: 0 },
        },
      ]),
      ctx(),
    );
    const params = validateActionSequence(
      sequenceOf([
        {
          id: "params",
          kind: "static-preset",
          presetId: "static-flat",
          atMs: 1000,
          orderedObjectIds: [7, 8],
          params: { v1: "bad", v2: 0, v3: 0 },
        },
      ]),
      twoObjects(),
    );
    const tooFew = validateActionSequence(
      sequenceOf([
        {
          id: "few",
          kind: "static-preset",
          presetId: "static-flat",
          atMs: 1000,
          orderedObjectIds: [7],
          params: { v1: 0, v2: 0, v3: 0 },
        },
      ]),
      ctx(),
    );
    expect(mismatch.some((issue) => issue.code === "invalid-preset")).toBe(true);
    expect(duplicates.some((issue) => issue.code === "invalid-preset")).toBe(true);
    expect(params.some((issue) => issue.code === "invalid-preset")).toBe(true);
    expect(tooFew.some((issue) => issue.code === "invalid-preset")).toBe(true);
  });

  it("blocks a dynamic preset whose endMs is not greater than startMs", () => {
    const issues = validateActionSequence(
      sequenceOf([
        {
          id: "lvl",
          kind: "dynamic-preset",
          presetId: "dynamic-level",
          startMs: 1000,
          endMs: 1000,
          orderedObjectIds: [7, 8],
          params: { startV1: 0, targetV1: 10, v2: 0, v3: 0 },
          profiles: axisProfiles(),
        },
      ]),
      twoObjects(),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: "error", code: "invalid-dynamic-range", blockId: "lvl" }),
    );
    expect(() =>
      validateActionSequence(
        sequenceOf([
          {
            id: "lvl",
            kind: "dynamic-preset",
            presetId: "dynamic-level",
            startMs: 2000,
            endMs: 1000,
            orderedObjectIds: [7, 8],
            params: { startV1: 0, targetV1: 10, v2: 0, v3: 0 },
            profiles: axisProfiles(),
          },
        ]),
        twoObjects(),
      ),
    ).not.toThrow();
  });

  it("blocks duplicate motion poses at one time", () => {
    const issues = validateActionSequence(
      sequenceOf([
        { id: "a", kind: "pose", objectId: 7, atMs: 1500, pose: { v1: 1, v2: 0, v3: 0 } },
        { id: "b", kind: "pose", objectId: 7, atMs: 1500, pose: { v1: 2, v2: 0, v3: 0 } },
      ]),
      ctx(),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: "error", code: "duplicate-pose-time" }),
    );
  });

  it("blocks a collision between an authored pose and a preset-generated pose", () => {
    const issues = validateActionSequence(
      sequenceOf([
        { id: "pose", kind: "pose", objectId: 7, atMs: 1500, pose: origin },
        {
          id: "flat",
          kind: "static-preset",
          presetId: "static-flat",
          atMs: 1500,
          orderedObjectIds: [7, 8],
          params: { v1: 0, v2: 0, v3: 0 },
        },
      ]),
      twoObjects(),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: "error", code: "duplicate-pose-time", objectId: 7 }),
    );
  });
  it("blocks a pose inside another motion source on the same object", () => {
    const issues = validateActionSequence(
      sequenceOf([
        {
          id: "lvl-1",
          kind: "dynamic-preset",
          presetId: "dynamic-level",
          startMs: 1000,
          endMs: 3000,
          orderedObjectIds: [7, 8],
          params: { startV1: 0, targetV1: 100, v2: 0, v3: 0 },
          profiles: axisProfiles(),
        },
        { id: "mid", kind: "pose", objectId: 7, atMs: 1500, pose: { v1: 50, v2: 0, v3: 0 } },
      ]),
      twoObjects(),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: "error", code: "motion-overlap", objectId: 7 }),
    );
  });

  it("blocks overlapping dynamic ranges on the same object", () => {
    const issues = validateActionSequence(
      sequenceOf([
        {
          id: "a",
          kind: "dynamic-preset",
          presetId: "dynamic-level",
          startMs: 0,
          endMs: 2000,
          orderedObjectIds: [7, 8],
          params: { startV1: 0, targetV1: 10, v2: 0, v3: 0 },
          profiles: axisProfiles(),
        },
        {
          id: "b",
          kind: "dynamic-preset",
          presetId: "dynamic-level",
          startMs: 1000,
          endMs: 3000,
          orderedObjectIds: [7, 9],
          params: { startV1: 10, targetV1: 20, v2: 0, v3: 0 },
          profiles: axisProfiles(),
        },
      ]),
      ctx([
        { id: 7, enabledVirtualAxes: ["v1"], limits: {} },
        { id: 8, enabledVirtualAxes: ["v1"], limits: {} },
        { id: 9, enabledVirtualAxes: ["v1"], limits: {} },
      ]),
    );
    expect(issues.some((issue) => issue.code === "motion-overlap" && issue.objectId === 7)).toBe(
      true,
    );
  });

  it("does not treat endpoint-adjacent dynamic ranges as overlap", () => {
    const issues = validateActionSequence(
      sequenceOf(
        [
          {
            id: "a",
            kind: "dynamic-preset",
            presetId: "dynamic-level",
            startMs: 0,
            endMs: 1000,
            orderedObjectIds: [7, 8],
            params: { startV1: 0, targetV1: 10, v2: 0, v3: 0 },
            profiles: axisProfiles(),
          },
          {
            id: "b",
            kind: "dynamic-preset",
            presetId: "dynamic-level",
            startMs: 1000,
            endMs: 2000,
            orderedObjectIds: [7, 8],
            params: { startV1: 10, targetV1: 20, v2: 0, v3: 0 },
            profiles: axisProfiles(),
          },
        ],
        {
          segments: [
            { fromRef: "preset:a:7:1", toRef: "preset:b:7:0", settings: { profiles: axisProfiles() } },
            { fromRef: "preset:a:8:1", toRef: "preset:b:8:0", settings: { profiles: axisProfiles() } },
          ],
        },
      ),
      twoObjects(),
    );
    expect(issues.some((issue) => issue.code === "motion-overlap")).toBe(false);
  });

  it("blocks positions outside configured min/max on enabled axes", () => {
    const issues = validateActionSequence(
      sequenceOf([{ id: "pose", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 5000, v2: 0, v3: 0 } }]),
      ctx([{ id: 7, enabledVirtualAxes: ["v1"], limits: { v1: { min: -10, max: 10 } } }]),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "limit-exceeded",
        objectId: 7,
        blockId: "pose",
      }),
    );
  });

  it("blocks trapezoid peak velocity above maxVelocity", () => {
    expect(codesOf(travel900(), contextWith({
      maxVelocity: 374,
    }))).toContain("limit-exceeded");
  });

  it("blocks a moving axis whose profile is idle", () => {
    const issues = validateActionSequence(
      travel900({
        v1: { kind: "idle" },
        v2: { kind: "idle" },
        v3: { kind: "idle" },
      }),
      contextWith({ maxVelocity: 10_000 }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "idle-on-moving-axis",
        objectId: 7,
        segmentKey: "start->end",
      }),
    );
  });

  it("does not block when computed acceleration or deceleration would exceed a derived max", () => {
    expect(codesOf(travel900(), contextWith({
      maxVelocity: 375,
    }))).not.toContain("limit-exceeded");
  });

  it("includes axis, actual value, and maximum in a kinematics limit message", () => {
    const issues = validateActionSequence(
      travel900(),
      contextWith({
        maxVelocity: 374,
      }),
    );
    const exceeded = issues.find((issue) => issue.code === "limit-exceeded");
    expect(exceeded?.message).toMatch(/v1/);
    expect(exceeded?.message).toMatch(/374/);
    expect(exceeded?.segmentKey).toBe("start->end");
  });

  it("blocks a moving axis when maxVelocity is missing", () => {
    const issues = validateActionSequence(
      travel900(),
      contextWith({
        maxVelocity: undefined as unknown as number,
      }),
    );
    expect(issues.some((issue) => issue.code === "missing-motion-limit")).toBe(true);
    expect(issues.find((issue) => issue.code === "missing-motion-limit")?.segmentKey).toBe(
      "start->end",
    );
    expect(issues.find((issue) => issue.code === "missing-motion-limit")?.message).not.toMatch(
      /maxAcceleration|maxDeceleration/,
    );
  });

  it("does not require maxAcceleration or maxDeceleration on a moving axis", () => {
    expect(codesOf(travel900(), contextWith({
      maxVelocity: 10_000,
    }))).not.toContain("missing-motion-limit");
  });

  it("blocks a moving axis when minAccelTime is missing", () => {
    expect(codesOf(travel900(), contextWith({
      maxVelocity: 10_000,
      minAccelTime: undefined as unknown as number,
    }))).toContain("missing-motion-limit");
  });

  it("blocks a moving axis when maxVelocity is non-positive or non-finite", () => {
    expect(codesOf(travel900(), contextWith({
      maxVelocity: 0,
    }))).toContain("missing-motion-limit");
    expect(codesOf(travel900(), contextWith({
      maxVelocity: Number.NaN,
    }))).toContain("missing-motion-limit");
  });

  it("does not require motion limits on a stationary axis", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 3000, pose: origin },
      ],
      {
        segments: [{ fromRef: "start", toRef: "end", settings: { profiles: axisProfiles() } }],
      },
    );
    expect(codesOf(
      sequence,
      ctx([{ id: 7, enabledVirtualAxes: ["v1"], limits: { v1: { min: -1000, max: 1000 } } }]),
    )).not.toContain("missing-motion-limit");
  });

  it("does not require limits on a stationary sibling axis", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 3000, pose: { v1: 900, v2: 0, v3: 0 } },
      ],
      {
        segments: [{ fromRef: "start", toRef: "end", settings: { profiles: axisProfiles() } }],
      },
    );
    const issues = validateActionSequence(
      sequence,
      ctx([
        {
          id: 7,
          enabledVirtualAxes: ["v1", "v2"],
          limits: {
            v1: {
              min: -10_000,
              max: 10_000,
              maxVelocity: 10_000,
              minAccelTime: 1,
            },
            v2: { min: -20, max: 20 },
          },
        },
      ]),
    );
    expect(issues.some((issue) => issue.code === "missing-motion-limit")).toBe(false);
    expect(issues.some((issue) => issue.code === "limit-exceeded")).toBe(false);
  });

  it("blocks insufficient cruise when accel plus decel exceed duration", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 1500, pose: { v1: 900, v2: 0, v3: 0 } },
      ],
      {
        segments: [{ fromRef: "start", toRef: "end", settings: { profiles: axisProfiles(1000, 1000) } }],
      },
    );
    const issues = validateActionSequence(sequence, contextWith({ minAccelTime: 1 }));
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "insufficient-cruise",
        segmentKey: "start->end",
        objectId: 7,
      }),
    );
  });

  it("blocks accel or decel shorter than minAccelTime", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 3000, pose: { v1: 900, v2: 0, v3: 0 } },
      ],
      {
        segments: [{ fromRef: "start", toRef: "end", settings: { profiles: axisProfiles(200, 600) } }],
      },
    );
    expect(codesOf(sequence, contextWith({ minAccelTime: 1 }))).toContain("phase-shorter-than-min-accel");
  });

  it("only validates phase and cruise on travelling axes", () => {
    const shortPhaseProfiles: AxisMotionProfiles = {
      v1: trapezoid(1000, 1000),
      v2: trapezoid(200, 600),
      v3: trapezoid(600, 600),
    };
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 3000, pose: { v1: 900, v2: 0, v3: 0 } },
      ],
      {
        segments: [{ fromRef: "start", toRef: "end", settings: { profiles: shortPhaseProfiles } }],
      },
    );
    const issues = validateActionSequence(
      sequence,
      ctx([
        {
          id: 7,
          enabledVirtualAxes: ["v1", "v2"],
          limits: {
            v1: {
              min: -10_000,
              max: 10_000,
              maxVelocity: 10_000,
              minAccelTime: 1,
            },
            v2: {
              min: -20,
              max: 20,
              maxVelocity: 10_000,
              minAccelTime: 2,
            },
          },
        },
      ]),
    );
    expect(issues.some((issue) => issue.code === "phase-shorter-than-min-accel")).toBe(false);
  });

  it("reports phase-shorter only on the travelling axis with short phases", () => {
    const profiles: AxisMotionProfiles = {
      v1: trapezoid(200, 1000),
      v2: trapezoid(600, 600),
      v3: trapezoid(600, 600),
    };
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: origin },
        {
          id: "end",
          kind: "pose",
          objectId: 7,
          atMs: 3000,
          pose: { v1: 900, v2: 100, v3: 0 },
        },
      ],
      {
        segments: [{ fromRef: "start", toRef: "end", settings: { profiles } }],
      },
    );
    const issues = validateActionSequence(
      sequence,
      ctx([
        {
          id: 7,
          enabledVirtualAxes: ["v1", "v2"],
          limits: {
            v1: {
              min: -10_000,
              max: 10_000,
              maxVelocity: 10_000,
              minAccelTime: 1,
            },
            v2: {
              min: -20,
              max: 20,
              maxVelocity: 10_000,
              minAccelTime: 0.5,
            },
          },
        },
      ]),
    );
    const phaseIssues = issues.filter((issue) => issue.code === "phase-shorter-than-min-accel");
    expect(phaseIssues).toHaveLength(1);
    expect(phaseIssues[0]?.message).toMatch(/v1/);
  });

  it("blocks insufficient cruise before kinematics", () => {
    const sequence = travel900(axisProfiles(2700, 600));
    const issues = validateActionSequence(sequence, contextWith({ minAccelTime: 0.5 }));
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "insufficient-cruise",
        message: expect.stringMatching(/start.*end/),
      }),
    );
    expect(issues.some((issue) => issue.code === "invalid-preset")).toBe(false);
  });

  it("blocks an invalid dynamic-preset shared profile before kinematics", () => {
    const sequence = sequenceOf([
      {
        id: "lvl",
        kind: "dynamic-preset",
        presetId: "dynamic-level",
        startMs: 0,
        endMs: 3000,
        orderedObjectIds: [7, 8],
        params: { startV1: 0, targetV1: 900, v2: 0, v3: 0 },
        profiles: axisProfiles(0, 600),
      },
    ]);
    const issues = validateActionSequence(
      sequence,
      ctx([
        {
          id: 7,
          enabledVirtualAxes: ["v1"],
          limits: {
            v1: {
              min: -10_000,
              max: 10_000,
              maxVelocity: 10_000,
              minAccelTime: 1,
            },
          },
        },
        {
          id: 8,
          enabledVirtualAxes: ["v1"],
          limits: {
            v1: {
              min: -10_000,
              max: 10_000,
              maxVelocity: 10_000,
              minAccelTime: 1,
            },
          },
        },
      ]),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "invalid-motion-profile",
        blockId: "lvl",
      }),
    );
    expect(issues.some((issue) => issue.code === "invalid-preset")).toBe(false);
  });

  it("blocks unresolved persisted segment endpoint refs", () => {
    const issues = validateActionSequence(
      sequenceOf(
        [{ id: "pose", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 10, v2: 0, v3: 0 } }],
        {
          segments: [{ fromRef: "gone", toRef: "missing", settings: { profiles: axisProfiles() } }],
        },
      ),
      ctx(),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: "error", code: "unresolved-segment" }),
    );
  });

  it("warns when a dynamic preset boundary pose is discontinuous", () => {
    const issues = validateActionSequence(
      sequenceOf([
        { id: "before", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 0, v2: 0, v3: 0 } },
        {
          id: "lvl-1",
          kind: "dynamic-preset",
          presetId: "dynamic-level",
          startMs: 1000,
          endMs: 2000,
          orderedObjectIds: [7, 8],
          params: { startV1: 80, targetV1: 90, v2: 0, v3: 0 },
          profiles: axisProfiles(),
        },
      ]),
      twoObjects(),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "boundary-discontinuity" }),
    );
  });

  it("warns when a wave wait hold jumps to the first visible keyframe", () => {
    const issues = validateActionSequence(
      sequenceOf([
        { id: "prior", kind: "pose", objectId: 8, atMs: 0, pose: { v1: 200, v2: 0, v3: 0 } },
        {
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
          },
          profiles: axisProfiles(100, 100),
        },
      ]),
      twoObjects(),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "boundary-discontinuity",
        objectId: 8,
        blockId: "wave-1",
        atMs: 1500,
      }),
    );
  });

  it("warns for idle holds at LONG_IDLE_MS and not just below it", () => {
    expect(LONG_IDLE_MS).toBe(10_000);
    const idle = validateActionSequence(
      sequenceOf([
        { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: origin },
        { id: "pose", kind: "pose", objectId: 7, atMs: LONG_IDLE_MS, pose: origin },
      ]),
      ctx(),
    );
    const short = validateActionSequence(
      sequenceOf([
        { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: origin },
        { id: "pose", kind: "pose", objectId: 7, atMs: LONG_IDLE_MS - 1, pose: origin },
      ]),
      ctx(),
    );
    expect(idle).toContainEqual(expect.objectContaining({ severity: "warning", code: "long-idle" }));
    expect(short.some((issue) => issue.code === "long-idle")).toBe(false);
  });

  it("does not treat a long moving segment as idle", () => {
    const issues = validateActionSequence(
      sequenceOf([
        { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: origin },
        { id: "pose", kind: "pose", objectId: 7, atMs: LONG_IDLE_MS, pose: { v1: 80, v2: 0, v3: 0 } },
      ]),
      ctx([{ id: 7, enabledVirtualAxes: ["v1"], limits: { v1: { min: -1000, max: 1000 } } }]),
    );
    expect(issues.some((issue) => issue.code === "long-idle")).toBe(false);
  });

  it("same-time matching enable events are not a command conflict", () => {
    const issues = validateActionSequence(
      sequenceOf([
        { id: "a", kind: "instruction",
      presetId: "set-enabled", objectId: 7, atMs: 500, instr: { enabled: true } },
        { id: "b", kind: "instruction",
      presetId: "set-enabled", objectId: 7, atMs: 500, instr: { enabled: true } },
      ]),
      ctx(),
    );
    expect(issues.some((issue) => issue.code === "command-conflict")).toBe(false);
  });
});

describe("invalidTimelineTargets", () => {
  it("collects error block and segment ids and ignores warnings", () => {
    const targets = invalidTimelineTargets([
      { severity: "warning", code: "long-idle", message: "idle", blockId: "idle", segmentKey: "a->b" },
      { severity: "error", code: "limit-exceeded", message: "first", blockId: "pose" },
      { severity: "error", code: "motor-overspeed", message: "second", segmentKey: "a->b" },
      { severity: "error", code: "invalid-time", message: "third" },
    ]);
    expect([...targets.blockIds]).toEqual(["pose"]);
    expect([...targets.segmentKeys]).toEqual(["a->b"]);
    expect(targets.blockMessage.get("pose")).toBe("first");
    expect(targets.segmentMessage.get("a->b")).toBe("second");
  });

  it("highlights phase and cruise errors on segments", () => {
    const targets = invalidTimelineTargets([
      {
        severity: "error",
        code: "phase-shorter-than-min-accel",
        message: "phase",
        segmentKey: "a->b",
        objectId: 7,
      },
      {
        severity: "error",
        code: "insufficient-cruise",
        message: "cruise",
        segmentKey: "c->d",
        objectId: 7,
      },
    ]);
    expect([...targets.segmentKeys]).toEqual(["a->b", "c->d"]);
  });
});

describe("hasBlockingSequenceIssues", () => {
  it("is true only when an error-severity issue exists", () => {
    expect(
      hasBlockingSequenceIssues([{ severity: "warning", code: "long-idle", message: "w" }]),
    ).toBe(false);
    expect(
      hasBlockingSequenceIssues([
        { severity: "warning", code: "long-idle", message: "w" },
        { severity: "error", code: "invalid-time", message: "e" },
      ]),
    ).toBe(true);
    expect(hasBlockingSequenceIssues(validateActionSequence(sequenceOf([]), ctx()))).toBe(false);
  });
});

describe("validateActionSequence isolation", () => {
  it("still returns authored issues when resolve would throw", () => {
    const bad = sequenceOf([
      {
        id: "bad",
        kind: "static-preset",
        presetId: "static-slope",
        atMs: 1000,
        orderedObjectIds: [7, 8],
        params: { baseV1: Number.NaN, stepV1: 1, v2: 0, v3: 0 },
      },
    ]);
    const issues = validateActionSequence(bad, twoObjects());
    expect(codesOf(bad, twoObjects())).toContain("invalid-preset");
    expect(issues.every((issue) => typeof issue.message === "string")).toBe(true);
  });
});
