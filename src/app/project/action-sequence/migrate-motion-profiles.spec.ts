import { describe, expect, it } from "vitest";
import { createDefaultAxisProfiles } from "./motion-profile";
import {
  migrateActionSequenceProfiles,
  migrateLegacyMotionProfile,
  migrateSegmentSettings,
} from "./migrate-motion-profiles";
import type { ActionSequenceConfig, DynamicPresetBlock, MotionProfile } from "./types";

const legacyTrap = (
  accelRatio = 0.2,
  decelRatio = 0.2,
): { kind: "trapezoid"; params: { accelRatio: number; decelRatio: number } } => ({
  kind: "trapezoid",
  params: { accelRatio, decelRatio },
});

const trap = (accelMs: number, decelMs: number): MotionProfile => ({
  kind: "trapezoid",
  params: { accelMs, decelMs },
});

const sequenceOf = (
  overrides: Partial<ActionSequenceConfig> & Record<string, unknown>,
): ActionSequenceConfig =>
  ({
    id: 1,
    name: "Seq",
    trajectoryMode: "non-forced",
    blocks: [],
    segments: [],
    ...overrides,
  }) as ActionSequenceConfig;

describe("migrateLegacyMotionProfile", () => {
  it("converts 0.2/0.2 ratios at 1500 ms into 300 ms phases", () => {
    expect(migrateLegacyMotionProfile(legacyTrap(), 1500)).toEqual({
      kind: "trapezoid",
      params: { accelMs: 300, decelMs: 300 },
    });
  });

  it("writes 1 ms phases when duration is not positive", () => {
    expect(migrateLegacyMotionProfile(legacyTrap(0.4, 0.3), 0).params).toEqual({
      accelMs: 1,
      decelMs: 1,
    });
    expect(migrateLegacyMotionProfile(legacyTrap(0.4, 0.3), -20).params).toEqual({
      accelMs: 1,
      decelMs: 1,
    });
  });
});

describe("migrateSegmentSettings", () => {
  it("expands a legacy profile to v1/v2/v3 at 1500 ms", () => {
    const settings = migrateSegmentSettings({ profile: legacyTrap() }, 1500);
    expect(settings.profiles.v1.params).toEqual({ accelMs: 300, decelMs: 300 });
    expect(settings.profiles.v2.params).toEqual({ accelMs: 300, decelMs: 300 });
    expect(settings.profiles.v3.params).toEqual({ accelMs: 300, decelMs: 300 });
    expect(settings.profiles.v1).not.toBe(settings.profiles.v2);
    expect(settings).not.toHaveProperty("profile");
  });

  it("expands a legacy profile to 1 ms when duration is not positive", () => {
    expect(migrateSegmentSettings({ profile: legacyTrap() }, 0).profiles.v1.params).toEqual({
      accelMs: 1,
      decelMs: 1,
    });
  });

  it("clones already-new profiles without sharing refs", () => {
    const profiles = {
      v1: trap(100, 200),
      v2: trap(300, 400),
      v3: trap(500, 600),
    };
    const next = migrateSegmentSettings({ profiles }, 9000);
    expect(next.profiles).toEqual(profiles);
    expect(next.profiles).not.toBe(profiles);
    expect(next.profiles.v1).not.toBe(profiles.v1);
    expect(next.profiles.v1.params).not.toBe(profiles.v1.params);
    expect(next.profiles.v2).not.toBe(profiles.v2);
    expect(next.profiles.v3).not.toBe(profiles.v3);
  });

  it("keeps idle axes instead of rewriting them to default trapezoids", () => {
    const profiles = {
      v1: trap(100, 200),
      v2: { kind: "idle" as const },
      v3: { kind: "idle" as const },
    };
    const next = migrateSegmentSettings({ profiles }, 9000);
    expect(next.profiles).toEqual(profiles);
    expect(next.profiles.v2).not.toBe(profiles.v2);
    expect(next.profiles.v3).not.toBe(profiles.v3);
  });

  it("defaults missing settings from duration", () => {
    expect(migrateSegmentSettings({}, 1000)).toEqual({
      profiles: createDefaultAxisProfiles(1000),
    });
  });
});

describe("migrateActionSequenceProfiles", () => {
  it("uses pose atMs difference as segment duration", () => {
    const sequence = sequenceOf({
      blocks: [
        { id: "a", kind: "pose", objectId: 7, atMs: 500, pose: { v1: 0, v2: 0, v3: 0 } },
        { id: "b", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 1, v2: 0, v3: 0 } },
      ],
      segments: [
        {
          fromRef: "a",
          toRef: "b",
          settings: { profile: legacyTrap() },
        },
      ],
    });
    const next = migrateActionSequenceProfiles(sequence);
    expect(next.segments[0]?.settings.profiles.v1.params).toEqual({ accelMs: 300, decelMs: 300 });
    expect(next.segments[0]?.settings.profiles.v2.params).toEqual({ accelMs: 300, decelMs: 300 });
    expect(next.segments[0]?.settings.profiles.v3.params).toEqual({ accelMs: 300, decelMs: 300 });
    expect(next.segments[0]?.settings).not.toHaveProperty("profile");
    expect(next).not.toBe(sequence);
    expect(sequence.segments[0]?.settings).toHaveProperty("profile");
  });

  it("migrates a dynamic-preset legacy profile onto all three axes", () => {
    const sequence = sequenceOf({
      blocks: [
        {
          id: "dyn",
          kind: "dynamic-preset",
          presetId: "dynamic-level",
          startMs: 0,
          endMs: 1500,
          orderedObjectIds: [7],
          params: { startV1: 0, targetV1: 1, v2: 0, v3: 0 },
          profile: legacyTrap(),
        },
      ],
    });
    const next = migrateActionSequenceProfiles(sequence);
    const block = next.blocks[0] as DynamicPresetBlock;
    expect(block.kind).toBe("dynamic-preset");
    expect(block.profiles.v1.params).toEqual({ accelMs: 300, decelMs: 300 });
    expect(block.profiles.v2.params).toEqual({ accelMs: 300, decelMs: 300 });
    expect(block.profiles.v3.params).toEqual({ accelMs: 300, decelMs: 300 });
    expect(block).not.toHaveProperty("profile");
    expect(next.blocks[0]).not.toBe(sequence.blocks[0]);
  });
});
