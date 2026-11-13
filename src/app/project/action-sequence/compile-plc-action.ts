import type {
  cCompiledEvent,
  cCompiledModel,
  PlcCompiledAction,
  PlcCompiledTimeline,
} from "@shared/csocket/action-data-save";
import { roundProjectCoordinate } from "../project-quantity";
import { finalizePlcTimeline, trapezoidToCurveSegments } from "./curve-segments";
import { evaluateResolvedSequence } from "./evaluate-sequence";
import { instructionToCompiledEvent } from "./instruction-registry";
import { axisMoveCommands, type AxisMoveCommand } from "./move-commands";
import {
  objectAxisMotions,
  pinUncontrolledAxes,
  resolveActionSequence,
  type ResolvedActionSequence,
  uncontrolledAxesOf,
} from "./resolve-sequence";
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
  safetyRadius?: number;
};

export type PlcCompileContext = {
  objects: readonly PlcCompileObject[];
  hoistObjects?: SequenceValidationContext["hoistObjects"];
  /** 准备时各物体的实时虚轴值：序列不控制的轴在 move 表里填它 */
  livePoseByObjectId?: ReadonlyMap<number, Partial<Record<VirtualAxisId, number>>>;
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

/**
 * 非强制（C++ 按 move 下发）的帧表。帧 = 该物体的全部关键帧，加上中途要变速的时刻。
 * 正向时 C++ 在每一帧取下一帧的 pos / vel / accVel / decVel 下发 move，反向时取上一帧，
 * 所以一条在 t 时刻下发的 move 写在 t 的下一帧（反向写在上一帧）。
 * move 的 pos 是这段连续运动停下的位置：中途不停的位姿不当目标，只在变速时刻重发同一目标。
 * 没有 move 落在的帧：pos 是这一帧的虚轴值（曲线上本该到的值；序列不控制的轴是准备时的实时值），
 * 速度、加减速度、经过速度都为 0，C++ 不下发。
 */
const compileModels = (
  resolved: ResolvedActionSequence,
  objectById: Map<number, PlcCompileObject>,
  options: { reverse: boolean },
): cCompiledModel[] =>
  [...resolved.posesByObject.entries()]
    .sort((left, right) => compareNumber(left[0], right[0]))
    .flatMap(([deviceId, poses]) => {
      const object = objectById.get(deviceId);
      if (!object || poses.length === 0) return [];
      const enabledAxes = AXES.filter((axis) => object.enabledVirtualAxes.includes(axis));
      const objectSegments = resolved.segments.filter((segment) => segment.objectId === deviceId);
      const uncontrolled = uncontrolledAxesOf(resolved, deviceId);
      const commandsByAxis = new Map(
        enabledAxes.map((axis) => [
          axis,
          uncontrolled.includes(axis)
            ? new Map<number, AxisMoveCommand>()
            : new Map(
                axisMoveCommands(objectAxisMotions(objectSegments, axis), options).map((command) => [
                  command.atMs,
                  command,
                ]),
              ),
        ]),
      );
      const frames = [
        ...new Set([
          ...poses.map((pose) => roundProjectCoordinate(pose.atMs)),
          ...[...commandsByAxis.values()].flatMap((commands) => [...commands.keys()]),
        ]),
      ].sort(compareNumber);
      const timeBlockList = frames.map((time, index) => {
        // 正向：上一帧下发的 move 写在这一帧；反向：下一帧下发的写在这一帧
        const issuedAt = options.reverse ? frames[index + 1] : frames[index - 1];
        let poseAt: ModelPose | undefined;
        return {
          time,
          virtualAxis: enabledAxes.map((axis) => {
            const command = issuedAt === undefined ? undefined : commandsByAxis.get(axis)?.get(issuedAt);
            if (!command) {
              poseAt ??= evaluateResolvedSequence(resolved, time).get(deviceId);
              return { pos: roundProjectCoordinate(poseAt?.[axis] ?? 0), vel: 0, accVel: 0, decVel: 0, passVel: 0 };
            }
            return {
              pos: command.target,
              vel: command.velocity,
              accVel: command.acceleration,
              decVel: command.deceleration,
              passVel: command.passSpeed,
            };
          }),
        };
      });
      return [{ deviceId, timeBlockList }];
    });

export const compilePlcAction = (
  sequence: ActionSequenceConfig,
  context: PlcCompileContext,
  /** 反向运行：非强制的 move 时间块按倒走的曲线生成（强制轨迹的曲线行不受影响） */
  reverse = false,
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
    models: compileModels(
      context.livePoseByObjectId
        ? pinUncontrolledAxes(resolved, (objectId, axis) => context.livePoseByObjectId?.get(objectId)?.[axis])
        : resolved,
      objectById,
      { reverse },
    ),
    ioBlocks: sortIoBlocks(resolved.commands.map(instructionToCompiledEvent)),
  };
};
