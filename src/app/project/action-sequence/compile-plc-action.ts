import type {
  cCompiledEvent,
  cCompiledModel,
  PlcCompiledAction,
  PlcCompiledTimeline,
} from "@shared/csocket/action-data-save";
import { roundProjectCoordinate } from "../project-quantity";
import { axisKinematics, ZERO_AXIS_KINEMATICS } from "./axis-kinematics";
import { trapezoidToCurveSegments } from "./curve-segments";
import { instructionToCompiledEvent } from "./instruction-registry";
import {
  resolveActionSequence,
  type ResolvedActionSequence,
  type ResolvedPosePoint,
} from "./resolve-sequence";
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

const ioBlockDeviceId = (block: cCompiledEvent): number =>
  block.params.params[0]?.deviceId ?? 0;

const sortIoBlocks = (blocks: cCompiledEvent[]): cCompiledEvent[] =>
  [...blocks].sort((left, right) => {
    const timeDelta = compareNumber(left.time, right.time);
    if (timeDelta !== 0) return timeDelta;
    return compareNumber(ioBlockDeviceId(left), ioBlockDeviceId(right));
  });

const AXES: VirtualAxisId[] = ["v1", "v2", "v3"];

const compileModels = (
  resolved: ResolvedActionSequence,
  objectById: Map<number, PlcCompileObject>,
): cCompiledModel[] =>
  [...resolved.posesByObject.entries()]
    .sort((left, right) => compareNumber(left[0], right[0]))
    .flatMap(([deviceId, poses]) => {
      const object = objectById.get(deviceId);
      if (!object || poses.length === 0) return [];
      const enabledAxes = AXES.filter((axis) => object.enabledVirtualAxes.includes(axis));
      const objectSegments = resolved.segments.filter((segment) => segment.objectId === deviceId);
      const timeBlockList = poses.map((pose: ResolvedPosePoint, index) => {
        const prev = poses[index - 1];
        const segment = prev
          ? objectSegments.find(
              (item) => item.fromRef === prev.sourceRef && item.toRef === pose.sourceRef,
            )
          : undefined;
        return {
          time: pose.atMs,
          virtualAxis: enabledAxes.map((axis) => {
            const pos = roundProjectCoordinate(pose.pose[axis]);
            if (!segment) return { pos, ...ZERO_AXIS_KINEMATICS };
            const travel = segment.toPose[axis] - segment.fromPose[axis];
            return {
              pos,
              ...axisKinematics(segment.settings.profiles[axis], travel, segment.durationMs),
            };
          }),
        };
      });
      return [{ deviceId, timeBlockList }];
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
    models: compileModels(resolved, objectById),
    ioBlocks: sortIoBlocks(resolved.commands.map(instructionToCompiledEvent)),
  };
};
