import type {
  cCompiledEvent,
  cCompiledModel,
  PlcCompiledAction,
  PlcCompiledTimeline,
} from "@shared/csocket/action-data-save";
import { roundProjectCoordinate } from "../project-quantity";
import { ZERO_AXIS_KINEMATICS } from "./axis-kinematics";
import { axisMotionKinematics } from "./axis-motion";
import { finalizePlcTimeline, trapezoidToCurveSegments } from "./curve-segments";
import { instructionToCompiledEvent } from "./instruction-registry";
import {
  objectAxisMotions,
  resolveActionSequence,
  segmentAxisMotion,
  type ResolvedActionSequence,
  type ResolvedPosePoint,
  uncontrolledAxesOf,
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
  kinematicsAtStart: boolean,
): cCompiledModel[] =>
  [...resolved.posesByObject.entries()]
    .sort((left, right) => compareNumber(left[0], right[0]))
    .flatMap(([deviceId, poses]) => {
      const object = objectById.get(deviceId);
      if (!object || poses.length === 0) return [];
      const enabledAxes = AXES.filter((axis) => object.enabledVirtualAxes.includes(axis));
      const objectSegments = resolved.segments.filter((segment) => segment.objectId === deviceId);
      const timeBlockList = poses.map((pose: ResolvedPosePoint, index) => {
        const neighbor = kinematicsAtStart ? poses[index + 1] : poses[index - 1];
        const segment = neighbor
          ? objectSegments.find((item) =>
              kinematicsAtStart
                ? item.fromRef === pose.sourceRef && item.toRef === neighbor.sourceRef
                : item.fromRef === neighbor.sourceRef && item.toRef === pose.sourceRef,
            )
          : undefined;
        return {
          time: pose.atMs,
          // 位置按启用的轴排；这一帧不设定的轴放 null，C++ 按前后设定值之间的曲线继续运动
          // passVel：经过这一帧的速度，连续衔接的中间位姿不为 0
          virtualAxis: enabledAxes.map((axis) => {
            if (pose.unsetAxes?.includes(axis)) return null;
            const pos = roundProjectCoordinate(pose.pose[axis]);
            const passVel = roundProjectCoordinate(pose.junctions?.[axis]?.speed ?? 0);
            if (!segment) return { pos, ...ZERO_AXIS_KINEMATICS, passVel };
            return { pos, ...axisMotionKinematics(segmentAxisMotion(segment, axis)), passVel };
          }),
        };
      });
      return [{ deviceId, timeBlockList }];
    });

export const compilePlcAction = (
  sequence: ActionSequenceConfig,
  context: PlcCompileContext,
  /** true：速度和加减速写在区间起点；false：写在终点。 */
  kinematicsAtStart = false,
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
      // 序列不控制的轴不下发曲线
      const uncontrolled = uncontrolledAxesOf(resolved, modelId);

      return object.enabledVirtualAxes.filter((axis) => !uncontrolled.includes(axis)).map((axis) => {
        const virtualAxisNo = VIRTUAL_AXIS_NO[axis];
        // 轴在中间位姿不设定时，跨过的几段是同一条曲线，只写一次
        const motions = objectAxisMotions(objectSegments, axis);
        const segments =
          motions.length === 0
            ? trapezoidToCurveSegments(
                { kind: "idle" },
                first.atMs,
                first.pose[axis],
                first.pose[axis],
                0,
              )
            : motions.flatMap((motion) =>
                trapezoidToCurveSegments(
                  motion.profile,
                  motion.startMs,
                  motion.from,
                  motion.to,
                  motion.durationMs,
                  motion,
                ),
              );
        const endPose = poses[poses.length - 1]?.pose[axis] ?? first.pose[axis];
        const lastMotion = motions[motions.length - 1];
        const closed = finalizePlcTimeline(
          segments,
          resolved.totalMs,
          endPose,
          lastMotion ? { atMs: lastMotion.endMs, position: lastMotion.to } : undefined,
        );
        if (closed.length > MAX_PLC_CURVE_SEGMENTS) {
          throw new Error(`PLC timeline segmentCount exceeds ${MAX_PLC_CURVE_SEGMENTS}`);
        }
        return { modelId, virtualAxisNo, segments: closed };
      });
    }),
  );

  return {
    totalDuration: resolved.totalMs,
    timelines,
    models: compileModels(resolved, objectById, kinematicsAtStart),
    ioBlocks: sortIoBlocks(resolved.commands.map(instructionToCompiledEvent)),
  };
};
