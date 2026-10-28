import type { ActionStartMode } from "@shared/csocket/action-data-save";
import type {
  ControlledObjectConfig,
  MotorConfig,
  VirtualAxisId,
} from "../project-document-types";
import { ALGORITHM_SETTINGS, buildAlgorithmModels } from "./algorithm-models";
import type { AlgorithmModel, Hpy } from "./algorithm-params";
import { calculateNearestEntry, type NearestEntryResult } from "./nearest-entry";
import { pointToPointPositionAt, type AxisVad, type HpyPose } from "./nearest-start-motion";
import type { ResolvedActionSequence } from "./resolve-sequence";
import type { ModelPose } from "./types";

/**
 * 启动接入：按 python/就近计算 的新就近算法（强制 / 非强制都走停稳同步准备）
 * 选出接入帧，并算出各成员同时到达所需的 V/A/D 与共同准备时间。
 * 准备速度上限用物体默认速度：算法读 max_velocity_HPY，只在传入前替换。
 */

export type { AxisVad } from "./nearest-start-motion";

export type NearestStartInput = {
  resolved: ResolvedActionSequence;
  objects: readonly ControlledObjectConfig[];
  motors: readonly MotorConfig[];
  telemetryByObjectId: ReadonlyMap<number, HpyPose>;
  forced: boolean;
  nearest: boolean;
  reverse: boolean;
  /** PLC 循环配置：0 一直循环，1 播一次 */
  loopCount: number;
  /**
   * 参考帧（ms，算法的 stopped_time_ms），只在开启就近时生效：正向只在 [参考帧, 末帧]、
   * 反向只在 [首帧, 参考帧] 里找位置最近的接入帧，结果不一定是参考帧本身。
   * 任务卡的继续 / 反向回传入停下时的 runTime。
   */
  referenceFrameMs?: number;
};

export type NearestStartAxisMove = AxisVad & {
  axis: VirtualAxisId;
  from: number;
  to: number;
  durationSec: number;
};

export type NearestStartMemberPlan = {
  objectId: number;
  from: ModelPose;
  target: ModelPose;
  /** 要移动的轴；不在里面的轴准备时不动，1006 下发 0 */
  axes: NearestStartAxisMove[];
  arrivalSec: number;
  waitSec: number;
};

export type NearestStartPlan = {
  forced: boolean;
  nearest: boolean;
  direction: 1 | -1;
  startMode: ActionStartMode;
  targetFrameMs: number;
  /** 共同准备时间，秒 */
  transitionSec: number;
  /** 1006 prepareTimeMs：共同准备时间向上取整到毫秒 */
  prepareTimeMs: number;
  /** 实际循环配置：曲线首尾不闭合时算法回退为 1 */
  loopCount: number;
  motorLimitScale: number | null;
  members: NearestStartMemberPlan[];
};

const AXES: readonly VirtualAxisId[] = ["v1", "v2", "v3"];

const poseOf = (values: Hpy): ModelPose => ({ v1: values[0], v2: values[1], v3: values[2] });

export const toNearestStartPlan = (
  result: NearestEntryResult,
  options: { forced: boolean; nearest: boolean },
): NearestStartPlan => {
  const transitionSec = result.prepare_time_ms / 1000;
  const members = result.devices.flatMap((group) =>
    group.models.map((model): NearestStartMemberPlan => {
      const from = poseOf(model.current_HPY);
      const target = poseOf(model.target_HPY);
      const axes = AXES.flatMap((axis, index): NearestStartAxisMove[] =>
        model.execute_HPY[index]
          ? [
              {
                axis,
                from: from[axis],
                to: target[axis],
                velocity: model.velocity_HPY[index]!,
                acceleration: model.acceleration_HPY[index]!,
                deceleration: model.deceleration_HPY[index]!,
                durationSec: transitionSec,
              },
            ]
          : [],
      );
      const moving = axes.length > 0;
      return {
        objectId: model.model_id,
        from,
        target,
        axes,
        arrivalSec: moving ? transitionSec : 0,
        waitSec: moving ? 0 : transitionSec,
      };
    }),
  );
  return {
    forced: options.forced,
    nearest: options.nearest,
    direction: result.reverse ? -1 : 1,
    startMode: options.nearest ? "nearest" : "boundary",
    targetFrameMs: result.selected_curve_time_ms,
    transitionSec,
    prepareTimeMs: result.prepare_time_ms_ceil,
    loopCount: result.effective_loop_count,
    motorLimitScale: result.motor_limit_scale,
    members,
  };
};

/**
 * 算法只收动作首末帧范围内的整数毫秒，超出就拒绝。PLC 上报的 runTime 可能早于第一段运动
 * （还没动就停了）或因取整略超末帧，取整后收进范围：早于首帧就从首帧起找，超出末帧按末帧。
 */
const referenceFrameIn = (models: readonly AlgorithmModel[], frameMs: number): number => {
  const first = Math.min(...models.map((model) => model.segments[0]!.start_frame));
  const last = Math.max(...models.map((model) => model.segments[model.segments.length - 1]!.end_frame));
  return Math.min(Math.max(first, Math.round(frameMs)), last);
};

export const planNearestStart = (input: NearestStartInput): NearestStartPlan => {
  const { models, runtime } = buildAlgorithmModels(input);
  if (models.length === 0) {
    // 没有要动的成员（只有指令块）：不需要准备，从第一帧（反向末帧）开始
    return {
      forced: input.forced,
      nearest: input.nearest,
      direction: input.reverse ? -1 : 1,
      startMode: input.nearest ? "nearest" : "boundary",
      targetFrameMs: input.reverse ? input.resolved.totalMs : 0,
      transitionSec: 0,
      prepareTimeMs: 0,
      loopCount: input.loopCount,
      motorLimitScale: null,
      members: [],
    };
  }
  const modelsAtDefaultSpeed = models.map((model) => {
    const [h, p, y] = model.default_velocity_HPY;
    return { ...model, max_velocity_HPY: [h, p, y] satisfies Hpy };
  });
  const result = calculateNearestEntry({
    command: {
      trajectory_run: input.forced,
      reverse: input.reverse,
      nearest_start: input.nearest,
      use_specified_time: false,
      stopped_time_ms:
        input.referenceFrameMs === undefined ? null : referenceFrameIn(models, input.referenceFrameMs),
      loop_count: input.loopCount,
    },
    settings: ALGORITHM_SETTINGS,
    models: modelsAtDefaultSpeed,
    runtime: { models: runtime },
  });
  const plan = toNearestStartPlan(result, input);
  // 整条序列只有一刻时模型向后补了 1ms，接入帧不超过序列总时长
  return { ...plan, targetFrameMs: Math.min(plan.targetFrameMs, Math.max(0, input.resolved.totalMs)) };
};

/** 准备开始后 elapsedMs 时各成员的位姿；所有移动轴同时到达 */
export const nearestStartPosesAt = (
  plan: NearestStartPlan,
  elapsedMs: number,
): Map<number, ModelPose> => {
  const tSec = Math.max(0, elapsedMs) / 1000;
  const poses = new Map<number, ModelPose>();
  for (const member of plan.members) {
    const pose = { ...member.from };
    for (const move of member.axes) {
      pose[move.axis] = pointToPointPositionAt(move.from, move.to, move, tSec);
    }
    poses.set(member.objectId, pose);
  }
  return poses;
};
