import {
  cloneAxisProfiles,
  createDefaultAxisProfiles,
} from "./motion-profile";
import type {
  ActionSequenceConfig,
  AxisMotionProfiles,
  DynamicPresetBlock,
  MotionProfile,
  MotionSegmentSettings,
  TimelineBlock,
} from "./types";

type LegacyTrapezoid = {
  kind: "trapezoid";
  params: { accelRatio: number; decelRatio: number };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNewAxisProfile = (value: unknown): value is MotionProfile => {
  if (!isRecord(value) || value.kind !== "trapezoid" || !isRecord(value.params)) return false;
  return Number.isFinite(value.params.accelMs) && Number.isFinite(value.params.decelMs);
};

const isNewAxisProfiles = (value: unknown): value is AxisMotionProfiles =>
  isRecord(value) &&
  isNewAxisProfile(value.v1) &&
  isNewAxisProfile(value.v2) &&
  isNewAxisProfile(value.v3);

const isLegacyTrapezoid = (value: unknown): value is LegacyTrapezoid =>
  isRecord(value) &&
  value.kind === "trapezoid" &&
  isRecord(value.params) &&
  "accelRatio" in value.params &&
  "decelRatio" in value.params;

const expandLegacy = (legacy: LegacyTrapezoid, durationMs: number): AxisMotionProfiles => ({
  v1: migrateLegacyMotionProfile(legacy, durationMs),
  v2: migrateLegacyMotionProfile(legacy, durationMs),
  v3: migrateLegacyMotionProfile(legacy, durationMs),
});

export const migrateLegacyMotionProfile = (
  legacy: LegacyTrapezoid,
  durationMs: number,
): MotionProfile => {
  if (durationMs > 0) {
    return {
      kind: "trapezoid",
      params: {
        accelMs: legacy.params.accelRatio * durationMs,
        decelMs: legacy.params.decelRatio * durationMs,
      },
    };
  }
  return { kind: "trapezoid", params: { accelMs: 1, decelMs: 1 } };
};

export const migrateSegmentSettings = (
  settings: unknown,
  durationMs: number,
): MotionSegmentSettings => {
  if (isRecord(settings) && isNewAxisProfiles(settings.profiles)) {
    return { profiles: cloneAxisProfiles(settings.profiles) };
  }
  if (isRecord(settings) && isLegacyTrapezoid(settings.profile)) {
    return { profiles: expandLegacy(settings.profile, durationMs) };
  }
  return { profiles: createDefaultAxisProfiles(durationMs) };
};

const blockTimeMs = (block: TimelineBlock, role: "from" | "to"): number | undefined => {
  switch (block.kind) {
    case "pose":
    case "static-preset":
    case "set-enabled":
      return block.atMs;
    case "dynamic-preset":
      return role === "from" ? block.startMs : block.endMs;
  }
};

const segmentDurationMs = (
  sequence: ActionSequenceConfig,
  fromRef: string,
  toRef: string,
): number => {
  const byId = new Map(sequence.blocks.map((block) => [block.id, block]));
  const from = byId.get(fromRef);
  const to = byId.get(toRef);
  if (from === undefined || to === undefined) return 0;
  const fromTime = blockTimeMs(from, "from");
  const toTime = blockTimeMs(to, "to");
  if (fromTime === undefined || toTime === undefined) return 0;
  return Math.max(toTime - fromTime, 0);
};

const migrateDynamicPreset = (block: DynamicPresetBlock): DynamicPresetBlock => {
  const durationMs = Math.max(block.endMs - block.startMs, 0);
  const { profile: legacy, ...rest } = block as DynamicPresetBlock & { profile?: unknown };
  if (isNewAxisProfiles(rest.profiles)) {
    return { ...rest, profiles: cloneAxisProfiles(rest.profiles) };
  }
  if (isLegacyTrapezoid(legacy)) {
    return { ...rest, profiles: expandLegacy(legacy, durationMs) };
  }
  return rest as DynamicPresetBlock;
};

export const migrateActionSequenceProfiles = (
  sequence: ActionSequenceConfig,
): ActionSequenceConfig => {
  const next = structuredClone(sequence);
  next.segments = next.segments.map((segment) => ({
    fromRef: segment.fromRef,
    toRef: segment.toRef,
    settings: migrateSegmentSettings(
      segment.settings,
      segmentDurationMs(next, segment.fromRef, segment.toRef),
    ),
  }));
  next.blocks = next.blocks.map((block) =>
    block.kind === "dynamic-preset" ? migrateDynamicPreset(block) : block,
  );
  return next;
};
