import type {
  PlcCompiledAction,
  PlcCompiledEvent,
  PlcCompiledTimeline,
} from "@shared/csocket/action-data-save";
import type { TrajectoryMode } from "@shared/action-sequence";
import { evaluateResolvedSequence } from "./evaluate-sequence";
import { motionProfilePhaseBoundaries } from "./motion-profile";
import { resolveActionSequence, type ResolvedMotionSegment } from "./resolve-sequence";
import type { ActionSequenceConfig, ModelPose } from "./types";
import {
  hasBlockingSequenceIssues,
  validateActionSequence,
  type SequenceValidationContext,
  type VirtualAxisId,
} from "./validate-sequence";

export type PlcCompileObject = {
  id: number;
  enabledVirtualAxes: readonly VirtualAxisId[];
  limits: SequenceValidationContext["objects"][number]["limits"];
};

export type PlcCompileContext = {
  objects: readonly PlcCompileObject[];
  sampleIntervalMs: number;
  hoistObjects?: SequenceValidationContext["hoistObjects"];
};

const VIRTUAL_AXIS_TYPE: Record<VirtualAxisId, number> = {
  v1: 0,
  v2: 1,
  v3: 2,
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (0xedb88320 ^ (crc >>> 1)) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  return table;
})();

const crc32Utf8 = (text: string): number => {
  const bytes = new TextEncoder().encode(text);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    const tableIndex = (crc ^ byte) & 0xff;
    crc = CRC32_TABLE[tableIndex]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key]);
    }
    return sorted;
  }
  return value;
};

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

const compareNumber = (left: number, right: number): number => left - right;

const sortTimelines = (timelines: PlcCompiledTimeline[]): PlcCompiledTimeline[] =>
  [...timelines].sort((left, right) => {
    const modelDelta = compareNumber(left.modelNo, right.modelNo);
    if (modelDelta !== 0) return modelDelta;
    return compareNumber(left.virtualAxisType, right.virtualAxisType);
  });

const sortEvents = (events: PlcCompiledEvent[]): PlcCompiledEvent[] =>
  [...events].sort((left, right) => {
    const timeDelta = compareNumber(left.atMs, right.atMs);
    if (timeDelta !== 0) return timeDelta;
    const modelDelta = compareNumber(left.modelNo, right.modelNo);
    if (modelDelta !== 0) return modelDelta;
    if (left.enabled === right.enabled) return 0;
    return left.enabled ? 1 : -1;
  });

const checksumOf = (
  trajectoryMode: TrajectoryMode,
  totalDuration: number,
  timelines: PlcCompiledTimeline[],
  events: PlcCompiledEvent[],
): number =>
  crc32Utf8(
    canonicalJson({
      trajectoryMode,
      totalDuration,
      timelines,
      events,
    }),
  );

const collectSampleTimes = (
  startMs: number,
  endMs: number,
  intervalMs: number,
  extras: Iterable<number>,
): number[] => {
  const times = new Set<number>([startMs, endMs]);
  if (intervalMs > 0) {
    for (let time = startMs + intervalMs; time < endMs; time += intervalMs) {
      times.add(time);
    }
  }
  for (const time of extras) {
    if (time >= startMs && time <= endMs) times.add(time);
  }
  return [...times].sort((left, right) => left - right);
};

const poseAxis = (pose: ModelPose | undefined, axis: VirtualAxisId, fallback: number): number =>
  pose === undefined ? fallback : pose[axis];

const segmentSampleBoundaries = (
  segment: ResolvedMotionSegment,
): number[] => {
  const { profiles } = segment.settings;
  const { startMs, durationMs } = segment;
  return [
    ...motionProfilePhaseBoundaries(profiles.v1, durationMs),
    ...motionProfilePhaseBoundaries(profiles.v2, durationMs),
    ...motionProfilePhaseBoundaries(profiles.v3, durationMs),
  ].map((ratio) => startMs + durationMs * ratio);
};

export const compilePlcAction = (
  sequence: ActionSequenceConfig,
  context: PlcCompileContext,
): PlcCompiledAction => {
  const issues = validateActionSequence(sequence, {
    objects: context.objects.map((object) => ({
      id: object.id,
      enabledVirtualAxes: [...object.enabledVirtualAxes],
      limits: object.limits,
    })),
    ...(context.hoistObjects ? { hoistObjects: context.hoistObjects } : {}),
  });
  if (hasBlockingSequenceIssues(issues)) {
    throw new Error("sequence has blocking validation issues");
  }

  const resolved = resolveActionSequence(sequence);
  const objectById = new Map(context.objects.map((object) => [object.id, object]));
  const trajectoryMode = sequence.trajectoryMode;

  const timelines = sortTimelines(
    [...resolved.posesByObject.entries()].flatMap(([modelNo, poses]) => {
      const object = objectById.get(modelNo);
      const first = poses[0];
      const last = poses[poses.length - 1];
      if (!object || first === undefined || last === undefined) return [];

      const startMs = first.atMs;
      const endMs = last.atMs;
      const extras = resolved.segments
        .filter((segment) => segment.objectId === modelNo)
        .flatMap((segment) => [
          segment.startMs,
          segment.endMs,
          ...segmentSampleBoundaries(segment),
        ]);
      const timeArray = collectSampleTimes(startMs, endMs, context.sampleIntervalMs, extras);
      const posesAtTime = timeArray.map((cursorMs) => evaluateResolvedSequence(resolved, cursorMs));

      return object.enabledVirtualAxes.map((axis) => ({
        modelNo,
        virtualAxisType: VIRTUAL_AXIS_TYPE[axis],
        timeArray: [...timeArray],
        positionArray: posesAtTime.map((posesAtCursor) =>
          poseAxis(posesAtCursor.get(modelNo), axis, first.pose[axis]),
        ),
      }));
    }),
  );

  const events = sortEvents(
    resolved.commands.map((command) => ({
      modelNo: command.objectId,
      atMs: command.atMs,
      kind: "set-enabled" as const,
      enabled: command.enabled,
    })),
  );

  const totalDuration = resolved.totalMs;
  return {
    checksum: checksumOf(trajectoryMode, totalDuration, timelines, events),
    trajectoryMode,
    totalDuration,
    timelines,
    events,
  };
};
