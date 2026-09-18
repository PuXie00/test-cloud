import type {
  PlcCompiledAction,
  PlcCompiledEvent,
  PlcCompiledTimeline,
} from "@shared/csocket/action-data-save";
import { trapezoidToCurveSegments } from "./curve-segments";
import { instructionToPlcEvent } from "./instruction-registry";
import { resolveActionSequence } from "./resolve-sequence";
import type { ActionSequenceConfig } from "./types";
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
  safetyRadius?: number;
};

export type PlcCompileContext = {
  objects: readonly PlcCompileObject[];
  hoistObjects?: SequenceValidationContext["hoistObjects"];
};

export const MAX_PLC_CURVE_SEGMENTS = 100;

const VIRTUAL_AXIS_NO: Record<VirtualAxisId, number> = {
  v1: 1,
  v2: 2,
  v3: 3,
};

const compareNumber = (left: number, right: number): number => left - right;

const sortTimelines = (timelines: PlcCompiledTimeline[]): PlcCompiledTimeline[] =>
  [...timelines].sort((left, right) => {
    const modelDelta = compareNumber(left.modelId, right.modelId);
    if (modelDelta !== 0) return modelDelta;
    return compareNumber(left.virtualAxisNo, right.virtualAxisNo);
  });

const sortEvents = (events: PlcCompiledEvent[]): PlcCompiledEvent[] =>
  [...events].sort((left, right) => {
    const timeDelta = compareNumber(left.atTime, right.atTime);
    if (timeDelta !== 0) return timeDelta;
    const modelDelta = compareNumber(left.modelId, right.modelId);
    if (modelDelta !== 0) return modelDelta;
    return left.enableFlag - right.enableFlag;
  });

export const compilePlcAction = (
  sequence: ActionSequenceConfig,
  context: PlcCompileContext,
): PlcCompiledAction => {
  const issues = validateActionSequence(sequence, {
    objects: context.objects.map((object) => ({
      id: object.id,
      enabledVirtualAxes: [...object.enabledVirtualAxes],
      limits: object.limits,
      ...(object.safetyRadius !== undefined ? { safetyRadius: object.safetyRadius } : {}),
    })),
    ...(context.hoistObjects ? { hoistObjects: context.hoistObjects } : {}),
  });
  if (hasBlockingSequenceIssues(issues)) {
    throw new Error("sequence has blocking validation issues");
  }

  const resolved = resolveActionSequence(sequence);
  const objectById = new Map(context.objects.map((object) => [object.id, object]));

  const timelines = sortTimelines(
    [...resolved.posesByObject.entries()].flatMap(([modelId, poses]) => {
      const object = objectById.get(modelId);
      const first = poses[0];
      if (!object || first === undefined) return [];
      const objectSegments = resolved.segments.filter((segment) => segment.objectId === modelId);

      return object.enabledVirtualAxes.map((axis) => {
        const virtualAxisNo = VIRTUAL_AXIS_NO[axis];
        const segments =
          objectSegments.length === 0
            ? trapezoidToCurveSegments(
                { kind: "idle" },
                first.atMs,
                first.pose[axis],
                first.pose[axis],
                0,
              )
            : objectSegments.flatMap((segment) =>
                trapezoidToCurveSegments(
                  segment.settings.profiles[axis],
                  segment.startMs,
                  segment.fromPose[axis],
                  segment.toPose[axis],
                  segment.durationMs,
                ),
              );
        if (segments.length > MAX_PLC_CURVE_SEGMENTS) {
          throw new Error(`PLC timeline segmentCount exceeds ${MAX_PLC_CURVE_SEGMENTS}`);
        }
        return { modelId, virtualAxisNo, segments };
      });
    }),
  );

  return {
    totalDuration: resolved.totalMs,
    timelines,
    events: sortEvents(resolved.commands.map(instructionToPlcEvent)),
  };
};
