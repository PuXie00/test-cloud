import { describe, expect, it } from "vitest";
import { resolvePreset } from "./preset-registry";
import { reconcileSegmentConfigs, resolveActionSequence } from "./resolve-sequence";
import type {
  ActionSequenceConfig,
  AxisMotionProfiles,
  DynamicPresetBlock,
  ModelPose,
  TimelineBlock,
} from "./types";
import { createDefaultAxisProfile, createDefaultAxisProfiles } from "./motion-profile";

const origin: ModelPose = { v1: 0, v2: 0, v3: 0 };

const axisProfiles = (accelMs: number, decelMs: number): AxisMotionProfiles => ({
  v1: { kind: "trapezoid", params: { accelMs, decelMs } },
  v2: { kind: "trapezoid", params: { accelMs, decelMs } },
  v3: { kind: "trapezoid", params: { accelMs, decelMs } },
});

const movingV1IdleOthers = (accelMs: number, decelMs: number): AxisMotionProfiles => ({
  v1: { kind: "trapezoid", params: { accelMs, decelMs } },
  v2: { kind: "idle" },
  v3: { kind: "idle" },
});

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

const pose = (
  id: string,
  objectId: number,
  atMs: number,
  value: ModelPose,
): TimelineBlock => ({
  id,
  kind: "pose",
  objectId,
  atMs,
  pose: value,
});

describe("resolveActionSequence", () => {
  it("derives the earliest timed pose as each object's initial pose", () => {
    const resolved = resolveActionSequence(sequenceOf([
      pose("later", 7, 5000, { v1: 50, v2: 0, v3: 0 }),
      pose("first", 7, 3000, { v1: 30, v2: 0, v3: 0 }),
    ]));

    expect(resolved.initialPoseByObject.get(7)?.sourceRef).toBe("first");
    expect(resolved.initialPoseByObject.get(7)?.atMs).toBe(3000);
  });

  it("does not derive a segment from zero to the initial pose", () => {
    const resolved = resolveActionSequence(sequenceOf([
      pose("first", 7, 3000, origin),
      pose("second", 7, 5000, { v1: 100, v2: 0, v3: 0 }),
    ]));

    expect(resolved.segments).toMatchObject([
      { fromRef: "first", toRef: "second", startMs: 3000, endMs: 5000, durationMs: 2000 },
    ]);
  });

  it("can derive a static preset generated point as the object's initial pose", () => {
    const resolved = resolveActionSequence(
      sequenceOf([
        pose("later-pose", 7, 4000, { v1: 9, v2: 0, v3: 0 }),
        {
          id: "slope",
          kind: "static-preset",
          presetId: "static-slope",
          atMs: 1000,
          orderedObjectIds: [7, 8],
          params: { baseHeightMm: 0, slopeDeg: 0, spacingMm: 1000, alignTilt: false },
        },
      ]),
    );

    expect(resolved.initialPoseByObject.get(7)?.sourceRef).toBe("preset:slope:7:0");
    expect(resolved.initialPoseByObject.get(7)?.atMs).toBe(1000);
    expect(resolved.initialPoseByObject.get(7)?.sourceKind).toBe("static-preset");
    expect(resolved.posesByObject.get(7)?.[0]).toBe(resolved.initialPoseByObject.get(7));
    expect(resolved.initialPoseByObject.get(8)?.sourceRef).toBe("preset:slope:8:0");
  });

  it("can derive a dynamic preset generated point as the object's initial pose", () => {
    const resolved = resolveActionSequence(
      sequenceOf([
        {
          id: "lvl-1",
          kind: "dynamic-preset",
          presetId: "dynamic-level",
          startMs: 1000,
          endMs: 3000,
          orderedObjectIds: [7, 8],
          params: { startHeightMm: 0, endHeightMm: 100 },
          profiles: axisProfiles(400, 400),
        },
      ]),
    );

    expect(resolved.initialPoseByObject.get(7)?.sourceRef).toBe("preset:lvl-1:7:0");
    expect(resolved.initialPoseByObject.get(7)?.atMs).toBe(1000);
    expect(resolved.initialPoseByObject.get(7)?.sourceKind).toBe("dynamic-preset");
    expect(resolved.posesByObject.get(7)?.[0]).toBe(resolved.initialPoseByObject.get(7));
    expect(resolved.initialPoseByObject.get(8)?.sourceRef).toBe("preset:lvl-1:8:0");
  });

  it("expands one static preset into linked model poses", () => {
    const resolved = resolveActionSequence({
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "slope",
          kind: "static-preset",
          presetId: "static-slope",
          atMs: 1000,
          orderedObjectIds: [7, 8],
          params: { baseHeightMm: 0, slopeDeg: 0, spacingMm: 1000, alignTilt: false },
        },
      ],
      segments: [],
    });
    expect(resolved.poses.map((point) => point.sourceBlockId)).toEqual(["slope", "slope"]);
  });

  it("uses exact sourceRef conventions and includes the initial pose among timed poses", () => {
    const resolved = resolveActionSequence({
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "pose-1",
          kind: "pose",
          objectId: 7,
          atMs: 0,
          pose: { v1: 4, v2: 5, v3: 6 },
        },
      ],
      segments: [],
    });

    const initial = resolved.initialPoseByObject.get(7);
    expect(initial).toMatchObject({
      sourceRef: "pose-1",
      sourceBlockId: "pose-1",
      sourceKind: "pose",
      objectId: 7,
      atMs: 0,
      pose: { v1: 4, v2: 5, v3: 6 },
      editable: true,
    });
    expect(resolved.poses.map((point) => point.sourceRef)).toEqual(["pose-1"]);
    expect(resolved.poses[0]).toBe(initial);
    expect(resolved.posesByObject.get(7)?.[0]).toBe(initial);
    expect(resolved.segments).toEqual([]);
  });

  it("uses Task 2 sourceRef values from resolvePreset", () => {
    const block = {
      id: "slope",
      kind: "static-preset" as const,
      presetId: "static-slope",
      atMs: 1000,
      orderedObjectIds: [7, 8],
      params: { baseHeightMm: 0, slopeDeg: 0, spacingMm: 1000, alignTilt: false },
    };
    const presetPoints = resolvePreset(block);
    const resolved = resolveActionSequence(sequenceOf([block]));

    expect(resolved.poses.map((point) => [point.sourceRef, point.objectId, point.atMs, point.pose])).toEqual(
      presetPoints.map((point) => [point.sourceRef, point.objectId, point.atMs, point.pose]),
    );
    expect(resolved.poses.every((point) => point.sourceKind === "static-preset" && point.editable === false)).toBe(
      true,
    );
    expect(() =>
      resolveActionSequence(
        sequenceOf([
          {
            ...block,
            presetId: "does-not-exist",
          },
        ]),
      ),
    ).toThrow("unknown preset: does-not-exist");
  });

  it("sorts timed poses by atMs then sourceRef", () => {
    const resolved = resolveActionSequence(
      sequenceOf([
        {
          id: "zeta",
          kind: "pose",
          objectId: 8,
          atMs: 1000,
          pose: origin,
        },
        {
          id: "alpha",
          kind: "pose",
          objectId: 7,
          atMs: 1000,
          pose: origin,
        },
        {
          id: "late",
          kind: "pose",
          objectId: 7,
          atMs: 3000,
          pose: origin,
        },
      ]),
    );

    expect(resolved.poses.map((point) => point.sourceRef)).toEqual(["alpha", "zeta", "late"]);
    expect(resolved.posesByObject.get(7)?.map((point) => point.sourceRef)).toEqual(["alpha", "late"]);
  });

  it("sorts commands by atMs then stable id", () => {
    const resolved = resolveActionSequence(
      sequenceOf([
        { id: "b", kind: "instruction", presetId: "set-enabled", objectId: 8, atMs: 500, instr: { enabled: false } },
        { id: "z", kind: "instruction", presetId: "set-enabled", objectId: 7, atMs: 100, instr: { enabled: true } },
        { id: "a", kind: "instruction", presetId: "set-enabled", objectId: 7, atMs: 500, instr: { enabled: true } },
      ]),
    );

    expect(resolved.commands.map((command) => command.id)).toEqual(["z", "a", "b"]);
  });

  it("copies authored commands so mutating resolved commands cannot alias them", () => {
    const authoredCommand = {
      id: "enable-1",
      kind: "instruction" as const,
      presetId: "set-enabled" as const,
      objectId: 7,
      atMs: 400,
      instr: { enabled: true },
      label: "开",
    };
    const authored = sequenceOf([authoredCommand]);
    const resolved = resolveActionSequence(authored);
    const resolvedCommand = resolved.commands[0];

    expect(resolvedCommand).toEqual(authoredCommand);
    expect(resolvedCommand).not.toBe(authoredCommand);
    expect(resolvedCommand).not.toBe(authored.blocks[0]);

    if (resolvedCommand === undefined) {
      throw new Error("expected a resolved command");
    }
    resolvedCommand.instr.enabled = false;
    resolvedCommand.atMs = 1;
    resolvedCommand.label = "改";

    expect(authoredCommand).toEqual({
      id: "enable-1",
      kind: "instruction",
      presetId: "set-enabled",
      objectId: 7,
      atMs: 400,
      instr: { enabled: true },
      label: "开",
    });
    expect(authored.blocks[0]).toEqual(authoredCommand);
  });

  it("takes totalMs from timed poses, commands, and dynamic end", () => {
    expect(resolveActionSequence(sequenceOf([])).totalMs).toBe(0);
    expect(resolveActionSequence(sequenceOf([])).initialPoseByObject.size).toBe(0);
    expect(
      resolveActionSequence(
        sequenceOf([{ id: "enable", kind: "instruction",
      presetId: "set-enabled", objectId: 7, atMs: 750, instr: { enabled: true } }]),
      ).totalMs,
    ).toBe(750);
    expect(
      resolveActionSequence(
        sequenceOf([{ id: "enable", kind: "instruction",
      presetId: "set-enabled", objectId: 7, atMs: 750, instr: { enabled: true } }]),
      ).initialPoseByObject.size,
    ).toBe(0);

    const dynamic: DynamicPresetBlock = {
      id: "lvl-1",
      kind: "dynamic-preset",
      presetId: "dynamic-level",
      startMs: 100,
      endMs: 4000,
      orderedObjectIds: [7, 8],
      params: { startHeightMm: 0, endHeightMm: 10 },
      profiles: axisProfiles(780, 780),
    };
    expect(
      resolveActionSequence(
        sequenceOf([
          dynamic,
          { id: "pose-late", kind: "pose", objectId: 9, atMs: 2500, pose: origin },
          { id: "enable", kind: "instruction",
      presetId: "set-enabled", objectId: 7, atMs: 3000, instr: { enabled: true } },
        ]),
      ).totalMs,
    ).toBe(4000);
    expect(
      resolveActionSequence(
        sequenceOf([
          dynamic,
          { id: "pose-later", kind: "pose", objectId: 9, atMs: 5000, pose: origin },
        ]),
      ).totalMs,
    ).toBe(5000);
  });

  it("clones the owning dynamic preset profile onto every internal segment", () => {
    const profiles = axisProfiles(200, 600);
    const resolved = resolveActionSequence(
      sequenceOf([
        {
          id: "lvl-1",
          kind: "dynamic-preset",
          presetId: "dynamic-level",
          startMs: 1000,
          endMs: 3000,
          orderedObjectIds: [7, 8],
          params: { startHeightMm: 0, endHeightMm: 100 },
          profiles,
        },
      ]),
    );

    const internals = resolved.segments.filter((segment) => !segment.configurable);
    expect(internals).toHaveLength(2);
    expect(internals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectId: 7,
          fromRef: "preset:lvl-1:7:0",
          toRef: "preset:lvl-1:7:1",
          startMs: 1000,
          endMs: 3000,
          durationMs: 2000,
          configurable: false,
          ownerPresetBlockId: "lvl-1",
          settings: { profiles: axisProfiles(200, 600) },
        }),
        expect.objectContaining({
          objectId: 8,
          fromRef: "preset:lvl-1:8:0",
          toRef: "preset:lvl-1:8:1",
          configurable: false,
          ownerPresetBlockId: "lvl-1",
          settings: { profiles: axisProfiles(200, 600) },
        }),
      ]),
    );
    for (const segment of internals) {
      expect(segment.settings.profiles).not.toBe(profiles);
      const clonedV1 = segment.settings.profiles.v1;
      if (clonedV1.kind !== "trapezoid") throw new Error("expected trapezoid");
      expect(clonedV1.params).not.toBe(profiles.v1.params);
    }
    expect(internals.every((segment) => !("ownerPresetId" in segment))).toBe(true);
    expect(resolved.segments.filter((segment) => segment.configurable)).toEqual([]);
    expect(resolved.segments.every((segment) => segment.ownerPresetBlockId === "lvl-1")).toBe(true);
  });

  it("matches existing fromRef/toRef settings and defaults other configurable intervals to trapezoid", () => {
    const authoredSettings = {
      profiles: axisProfiles(225, 375),
    };
    const authored: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "pose-1",
          kind: "pose",
          objectId: 7,
          atMs: 1000,
          pose: { v1: 10, v2: 0, v3: 0 },
        },
        {
          id: "pose-2",
          kind: "pose",
          objectId: 7,
          atMs: 2500,
          pose: { v1: 20, v2: 0, v3: 0 },
        },
      ],
      segments: [
        {
          fromRef: "pose-1",
          toRef: "pose-2",
          settings: authoredSettings,
        },
      ],
    };
    const resolved = resolveActionSequence(authored);
    expect(resolved.initialPoseByObject.get(7)?.sourceRef).toBe("pose-1");
    expect(resolved.segments).toEqual([
      expect.objectContaining({
        fromRef: "pose-1",
        toRef: "pose-2",
        startMs: 1000,
        endMs: 2500,
        settings: { profiles: axisProfiles(225, 375) },
        configurable: true,
      }),
    ]);
    const matched = resolved.segments[0];
    expect(matched?.settings).not.toBe(authoredSettings);
    expect(matched?.settings.profiles).not.toBe(authoredSettings.profiles);
    const matchedV1 = matched?.settings.profiles.v1;
    if (matchedV1?.kind !== "trapezoid") throw new Error("expected trapezoid v1");
    expect(matchedV1.params).not.toBe(authoredSettings.profiles.v1.params);
    if (matched === undefined) {
      throw new Error("expected matched segment");
    }
    matchedV1.params.accelMs = 900;
    expect(authoredSettings.profiles.v1.params.accelMs).toBe(225);
    expect(authored.segments[0]?.settings.profiles.v1.params.accelMs).toBe(225);
  });

  it("includes the earliest pose in posesByObject and only derives adjacent segments", () => {
    const resolved = resolveActionSequence(
      sequenceOf([
        {
          id: "pose-1",
          kind: "pose",
          objectId: 7,
          atMs: 2000,
          pose: { v1: 1, v2: 0, v3: 0 },
        },
        {
          id: "pose-2",
          kind: "pose",
          objectId: 7,
          atMs: 4000,
          pose: { v1: 2, v2: 0, v3: 0 },
        },
      ]),
    );

    expect(resolved.initialPoseByObject.get(7)?.sourceRef).toBe("pose-1");
    expect(resolved.posesByObject.get(7)?.map((point) => point.sourceRef)).toEqual(["pose-1", "pose-2"]);
    expect(resolved.posesByObject.get(7)?.[0]).toBe(resolved.initialPoseByObject.get(7));
    expect(resolved.segments[0]).toMatchObject({
      fromRef: "pose-1",
      toRef: "pose-2",
      configurable: true,
      settings: { profiles: createDefaultAxisProfiles(2000) },
    });
    expect(resolved.segments).toEqual([
      expect.objectContaining({
        fromRef: "pose-1",
        toRef: "pose-2",
        startMs: 2000,
        endMs: 4000,
        durationMs: 2000,
        configurable: true,
      }),
    ]);
  });

  it("does not mutate the authored sequence", () => {
    const orderedObjectIds = [7, 8];
    const params = { startHeightMm: 0, endHeightMm: 10 };
    const blocks: TimelineBlock[] = [
      {
        id: "z",
        kind: "instruction",
        presetId: "set-enabled",
        objectId: 7,
        atMs: 800,
        instr: { enabled: true },
      },
      {
        id: "a",
        kind: "instruction",
        presetId: "set-enabled",
        objectId: 7,
        atMs: 100,
        instr: { enabled: false },
      },
      {
        id: "lvl-1",
        kind: "dynamic-preset",
        presetId: "dynamic-level",
        startMs: 100,
        endMs: 400,
        orderedObjectIds,
        params,
        profiles: axisProfiles(60, 60),
      },
    ];
    const segments = [
      {
        fromRef: "stale-start",
        toRef: "preset:lvl-1:7:0",
        settings: { profiles: axisProfiles(100, 300) },
      },
    ];
    const authored: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks,
      segments,
    };
    Object.freeze(orderedObjectIds);
    Object.freeze(params);
    Object.freeze(segments);
    Object.freeze(blocks);
    Object.freeze(authored);

    expect(() => resolveActionSequence(authored)).not.toThrow();
    expect(authored.blocks.map((block) => block.id)).toEqual(["z", "a", "lvl-1"]);
    expect(authored.segments).toEqual([
      {
        fromRef: "stale-start",
        toRef: "preset:lvl-1:7:0",
        settings: { profiles: axisProfiles(100, 300) },
      },
    ]);
  });

  it("keeps duplicate times and overlapping motion sources for validation", () => {
    const resolved = resolveActionSequence(
      sequenceOf([
        {
          id: "b",
          kind: "pose",
          objectId: 7,
          atMs: 1500,
          pose: { v1: 5, v2: 0, v3: 0 },
        },
        {
          id: "a",
          kind: "pose",
          objectId: 7,
          atMs: 1500,
          pose: { v1: 6, v2: 0, v3: 0 },
        },
        {
          id: "lvl-1",
          kind: "dynamic-preset",
          presetId: "dynamic-level",
          startMs: 1000,
          endMs: 3000,
          orderedObjectIds: [7, 8],
          params: { startHeightMm: 0, endHeightMm: 100 },
          profiles: axisProfiles(400, 400),
        },
      ]),
    );

    expect(resolved.posesByObject.get(7)?.map((point) => [point.sourceRef, point.atMs])).toEqual([
      ["preset:lvl-1:7:0", 1000],
      ["a", 1500],
      ["b", 1500],
      ["preset:lvl-1:7:1", 3000],
    ]);
    expect(resolved.initialPoseByObject.get(7)?.sourceRef).toBe("preset:lvl-1:7:0");
    expect(resolved.segments.filter((segment) => segment.objectId === 7)).toEqual([
      expect.objectContaining({
        fromRef: "preset:lvl-1:7:0",
        toRef: "a",
        startMs: 1000,
        endMs: 1500,
        configurable: true,
      }),
      expect.objectContaining({ fromRef: "a", toRef: "b", durationMs: 0, configurable: true }),
      expect.objectContaining({
        fromRef: "b",
        toRef: "preset:lvl-1:7:1",
        configurable: true,
      }),
    ]);
  });

  it("owns every dynamic-wave sample interval as a cloned shared profile", () => {
    const profiles = axisProfiles(400, 400);
    const block: DynamicPresetBlock = {
      id: "wave-1",
      kind: "dynamic-preset",
      presetId: "dynamic-wave",
      startMs: 1000,
      endMs: 3000,
      orderedObjectIds: [7, 8],
      params: {
        baseHeightMm: 1000,
        amplitudeMm: 500,
        cycles: 1,
        direction: 1,
        intervalDeg: 90,
      },
      profiles,
    };
    const resolved = resolveActionSequence(sequenceOf([block]));
    const internals = resolved.segments.filter((segment) => !segment.configurable);
    expect(internals).toHaveLength(40);
    expect(
      internals.every(
        (segment) =>
          segment.ownerPresetBlockId === "wave-1" &&
          segment.settings.profiles.v1.kind === "trapezoid" &&
          segment.settings.profiles.v1.params.accelMs === 400 &&
          segment.settings.profiles.v1.params.decelMs === 400 &&
          segment.settings.profiles !== profiles &&
          segment.settings.profiles.v1.params !== profiles.v1.params &&
          segment.configurable === false,
      ),
    ).toBe(true);
    expect(
      internals.filter((segment) => segment.objectId === 7).map((segment) => [segment.fromRef, segment.toRef]),
    ).toEqual(
      Array.from({ length: 20 }, (_, index) => [
        `preset:wave-1:7:${index}`,
        `preset:wave-1:7:${index + 1}`,
      ]),
    );
    expect(resolved.initialPoseByObject.get(7)?.sourceRef).toBe("preset:wave-1:7:0");
    expect(reconcileSegmentConfigs(resolved.segments, [])).toEqual([]);
  });
});

describe("reconcileSegmentConfigs", () => {
  it("keeps reviewed configurable configs and drops stale and internal intervals", () => {
    const existingReviewed = {
      fromRef: "pose-1",
      toRef: "preset:lvl-1:7:0",
      settings: { profiles: axisProfiles(100, 300) },
    };
    const existingInternal = {
      fromRef: "preset:lvl-1:7:0",
      toRef: "preset:lvl-1:7:1",
      settings: { profiles: axisProfiles(800, 800) },
    };
    const existingStale = {
      fromRef: "stale",
      toRef: "gone",
      settings: { profiles: axisProfiles(400, 400) },
    };
    const authored = sequenceOf(
      [
        {
          id: "pose-1",
          kind: "pose",
          objectId: 7,
          atMs: 500,
          pose: { v1: 1, v2: 0, v3: 0 },
        },
        {
          id: "lvl-1",
          kind: "dynamic-preset",
          presetId: "dynamic-level",
          startMs: 1000,
          endMs: 3000,
          orderedObjectIds: [7, 8],
          params: { startHeightMm: 10, endHeightMm: 20 },
          profiles: axisProfiles(400, 400),
        },
      ],
      {
        segments: [existingInternal, existingReviewed, existingStale],
      },
    );
    const resolved = resolveActionSequence(authored);

    expect(resolved.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromRef: "pose-1",
          toRef: "preset:lvl-1:7:0",
          configurable: true,
          settings: { profiles: axisProfiles(100, 300) },
        }),
      ]),
    );
    expect(resolved.initialPoseByObject.get(7)?.sourceRef).toBe("pose-1");

    const persisted = reconcileSegmentConfigs(resolved.segments, authored.segments);
    expect(persisted).toEqual([
      {
        fromRef: "pose-1",
        toRef: "preset:lvl-1:7:0",
        settings: { profiles: movingV1IdleOthers(100, 300) },
      },
    ]);
    expect(persisted[0]).not.toBe(existingReviewed);
    expect(persisted[0]?.settings).not.toBe(existingReviewed.settings);
    const persistedV1 = persisted[0]?.settings.profiles.v1;
    if (persistedV1?.kind !== "trapezoid") throw new Error("expected trapezoid v1");
    expect(persistedV1.params).not.toBe(existingReviewed.settings.profiles.v1.params);
    persistedV1.params.accelMs = 900;
    expect(existingReviewed.settings.profiles.v1.params.accelMs).toBe(100);
    expect(authored.segments[1]?.settings.profiles.v1.params.accelMs).toBe(100);
  });

  it("persists every configurable adjacency including default profiles", () => {
    const authored: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        {
          id: "pose-1",
          kind: "pose",
          objectId: 7,
          atMs: 2000,
          pose: { v1: 1, v2: 0, v3: 0 },
        },
        {
          id: "pose-2",
          kind: "pose",
          objectId: 7,
          atMs: 4000,
          pose: { v1: 2, v2: 0, v3: 0 },
        },
      ],
      segments: [],
    };
    const first = resolveActionSequence(authored);
    expect(first.segments[0]).toMatchObject({
      fromRef: "pose-1",
      toRef: "pose-2",
      configurable: true,
      settings: { profiles: createDefaultAxisProfiles(2000) },
    });
    const persisted = reconcileSegmentConfigs(first.segments, []);
    const expectedProfiles = {
      v1: createDefaultAxisProfile(2000),
      v2: { kind: "idle" as const },
      v3: { kind: "idle" as const },
    };
    expect(persisted).toEqual([
      {
        fromRef: "pose-1",
        toRef: "pose-2",
        settings: { profiles: expectedProfiles },
      },
    ]);
    const persistedV1 = persisted[0]?.settings.profiles.v1;
    const firstV1 = first.segments[0]?.settings.profiles.v1;
    if (persistedV1?.kind !== "trapezoid" || firstV1?.kind !== "trapezoid") {
      throw new Error("expected trapezoid v1");
    }
    expect(persistedV1.params).not.toBe(firstV1.params);
    const reloaded = resolveActionSequence({ ...authored, segments: persisted });
    expect(reloaded.segments[0]?.settings).toEqual({ profiles: expectedProfiles });
    expect(reloaded.segments[0]?.settings).not.toBe(first.segments[0]?.settings);
    const reloadedV1 = reloaded.segments[0]?.settings.profiles.v1;
    if (reloadedV1?.kind !== "trapezoid") throw new Error("expected trapezoid v1");
    expect(reloadedV1.params).not.toBe(persistedV1.params);
  });

  it("writes idle for zero-travel axes and restores default trapezoid when travel returns", () => {
    const authored: ActionSequenceConfig = {
      id: 1,
      name: "Seq",
      trajectoryMode: "non-forced",
      blocks: [
        { id: "a", kind: "pose", objectId: 7, atMs: 0, pose: { v1: 100, v2: 5, v3: 0 } },
        { id: "b", kind: "pose", objectId: 7, atMs: 5000, pose: { v1: 100, v2: 15, v3: 0 } },
      ],
      segments: [
        { fromRef: "a", toRef: "b", settings: { profiles: axisProfiles(200, 200) } },
      ],
    };
    const resolved = resolveActionSequence(authored);
    const persisted = reconcileSegmentConfigs(resolved.segments, authored.segments, {
      minAccelTimeByObject: () => ({ v2: 1 }),
    });
    expect(persisted[0]?.settings.profiles.v1).toEqual({ kind: "idle" });
    expect(persisted[0]?.settings.profiles.v3).toEqual({ kind: "idle" });
    expect(persisted[0]?.settings.profiles.v2).toEqual({
      kind: "trapezoid",
      params: { accelMs: 200, decelMs: 200 },
    });

    const idleAuthored: ActionSequenceConfig = {
      ...authored,
      blocks: [
        { id: "a", kind: "pose", objectId: 7, atMs: 0, pose: { v1: 0, v2: 5, v3: 0 } },
        { id: "b", kind: "pose", objectId: 7, atMs: 5000, pose: { v1: 80, v2: 15, v3: 0 } },
      ],
      segments: [
        {
          fromRef: "a",
          toRef: "b",
          settings: {
            profiles: {
              v1: { kind: "idle" },
              v2: { kind: "trapezoid", params: { accelMs: 200, decelMs: 200 } },
              v3: { kind: "idle" },
            },
          },
        },
      ],
    };
    const restored = reconcileSegmentConfigs(
      resolveActionSequence(idleAuthored).segments,
      idleAuthored.segments,
      { minAccelTimeByObject: () => ({ v1: 1, v2: 1 }) },
    );
    expect(restored[0]?.settings.profiles.v1).toEqual({
      kind: "trapezoid",
      params: { accelMs: 1000, decelMs: 1000 },
    });
    expect(restored[0]?.settings.profiles.v2).toEqual({
      kind: "trapezoid",
      params: { accelMs: 200, decelMs: 200 },
    });
    expect(restored[0]?.settings.profiles.v3).toEqual({ kind: "idle" });
  });
});
