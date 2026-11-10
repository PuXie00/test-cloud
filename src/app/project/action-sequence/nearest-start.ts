import type { ActionStartMode } from "@shared/csocket/action-data-save";
import type {
  ControlledObjectConfig,
  MotorConfig,
  VirtualAxisId,
} from "../project-document-types";
import { motionAxisIdForVirtualAxis } from "../virtual-axis-mapping";
import { ALGORITHM_SETTINGS, buildAlgorithmModels } from "./algorithm-models";
import type { AlgorithmModel, Hpy, RuntimeModelState } from "./algorithm-params";
import { calculateNearestEntry, type NearestEntryResult } from "./nearest-entry";
import { pointToPointPositionAt, type AxisVad, type HpyPose } from "./nearest-start-motion";
import {
  calculateNonforcedEntry,
  entryMovePositionAt,
  type EntryMove,
  type NonforcedEntryResult,
  type NonforcedPlannedResult,
} from "./nonforced-entry";
import type { ResolvedActionSequence } from "./resolve-sequence";
import type { ModelPose } from "./types";

/**
 * 启动接入：选出接入帧，并算出各成员的准备 Move 与共同准备时间。
 * - 强制：python/新就近算法 的停稳同步准备（nearest-entry），准备速度上限用物体默认速度
 *   （算法读 max_velocity_HPY，只在传入前替换）。
 * - 非强制：python/非强制就近接入.py（nonforced-entry）。每台设备 H/P/Y 各一条准备 Move，GO 时一起下发，
 *   接入帧时位置和速度都接上帧表；准备按真实最大能力（不换默认速度，否则曲线本身就会超出“能力”被判不可行）。
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
  /**
   * 指定接入帧（ms，算法的 use_specified_time），优先于就近和参考帧：强制正好从这一帧接入；
   * 非强制只把它当搜索起点，沿运行方向取位置最近的原关键帧，实际接入帧看结果的 targetFrameMs。
   */
  specifiedFrameMs?: number;
};

export type NearestStartAxisMove = AxisVad & {
  axis: VirtualAxisId;
  from: number;
  /** 准备结束时的位置：强制为停稳的目标；非强制为接入帧时曲线上的位置（不一定是停车点） */
  to: number;
  durationSec: number;
  /** 非强制：接入帧时这一轴的速度（有符号，单位/秒）；不为 0 时要助跑，位置没差也算要动 */
  joinVelocity?: number;
  /** 非强制：GO 时下发的准备 Move，原样给 C++；pos 是停车目标，不是接入点；设备没有的轴速度为 0（不下发） */
  entryMove?: EntryMove;
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
  /** 共同准备时间（GO 到接入帧），秒 */
  transitionSec: number;
  /** 1006 prepareTimeMs：共同准备时间向上取整到毫秒 */
  prepareTimeMs: number;
  /** 实际循环配置：强制轨迹曲线首尾不闭合时算法回退为 1 */
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

const firstFrameOf = (models: readonly AlgorithmModel[]): number =>
  Math.min(...models.map((model) => model.segments[0]!.start_frame));

const lastFrameOf = (models: readonly AlgorithmModel[]): number =>
  Math.max(...models.map((model) => model.segments[model.segments.length - 1]!.end_frame));

/**
 * 算法只收动作首末帧范围内的整数毫秒，超出就拒绝。PLC 上报的 runTime 可能早于第一段运动
 * （还没动就停了）或因取整略超末帧，取整后收进范围：早于首帧就从首帧起找，超出末帧按末帧。
 */
const referenceFrameIn = (models: readonly AlgorithmModel[], frameMs: number): number =>
  Math.min(Math.max(firstFrameOf(models), Math.round(frameMs)), lastFrameOf(models));

export type EntryFrames = {
  /** 正向的起点帧（算法的首帧） */
  firstMs: number;
  /** 反向的起点帧（算法的末帧，不超过序列总时长） */
  lastMs: number;
  /** 原动作段边界（各成员关键帧的并集），升序；时间轴上画刻度、点选时吸附用 */
  keyframesMs: number[];
};

/** 算法看到的接入帧范围与原关键帧，和 planNearestStart 用同一套模型 */
export const entryFramesOf = (
  input: Pick<NearestStartInput, "resolved" | "objects" | "motors" | "telemetryByObjectId">,
): EntryFrames => {
  const totalMs = Math.max(0, input.resolved.totalMs);
  const { models } = buildAlgorithmModels(input);
  if (models.length === 0) return { firstMs: 0, lastMs: totalMs, keyframesMs: [] };
  const frames = new Set<number>();
  for (const model of models) {
    for (const segment of model.segments) {
      frames.add(Math.min(segment.start_frame, totalMs));
      frames.add(Math.min(segment.end_frame, totalMs));
    }
  }
  return {
    firstMs: Math.min(firstFrameOf(models), totalMs),
    lastMs: Math.min(lastFrameOf(models), totalMs),
    keyframesMs: [...frames].sort((left, right) => left - right),
  };
};

/** 协议能表示的位置范围（int32 × 0.1）：没有行程参数的轴用它 */
const PROTOCOL_POSITION_LIMIT = 214748364.7;

/**
 * 非强制传给算法的行程：启用轴取物体运动参数的最小 / 最大位置，其它轴取协议范围。
 * 当前位置略超行程（编码器噪声、手动越位）时把这一侧放宽到当前位置，不因此拒绝准备；
 * 准备 Move 的目标和接入后的整段动作仍按行程检查。
 */
const withStroke = (
  model: AlgorithmModel,
  objects: readonly ControlledObjectConfig[],
  current: Hpy,
): AlgorithmModel => {
  const object = objects.find((item) => item.id === model.model_id);
  const lower: Hpy = [-PROTOCOL_POSITION_LIMIT, -PROTOCOL_POSITION_LIMIT, -PROTOCOL_POSITION_LIMIT];
  const upper: Hpy = [PROTOCOL_POSITION_LIMIT, PROTOCOL_POSITION_LIMIT, PROTOCOL_POSITION_LIMIT];
  AXES.forEach((axis, index) => {
    const params = object?.enabledVirtualAxes.includes(axis)
      ? object.motionParams[motionAxisIdForVirtualAxis(axis)]
      : undefined;
    if (params && Number.isFinite(params.minAngle) && Number.isFinite(params.maxAngle)) {
      lower[index] = params.minAngle;
      upper[index] = params.maxAngle;
    }
    lower[index] = Math.min(lower[index]!, current[index]!);
    upper[index] = Math.max(upper[index]!, current[index]!);
  });
  return { ...model, min_position_HPY: lower, max_position_HPY: upper };
};

/** 算法没给出方案时的报错：说明之外附上逐轴原因（指定帧、回起点的说明里已带原因） */
const nonforcedFailure = (result: NonforcedEntryResult): Error => {
  const reasons = "reasons" in result ? result.reasons.filter((reason) => !result.message.includes(reason)) : [];
  return new Error(reasons.length > 0 ? `${result.message}：${reasons.join("；")}` : result.message);
};

const toNonforcedStartPlan = (
  result: NonforcedPlannedResult,
  options: { nearest: boolean; loopCount: number; objects: readonly ControlledObjectConfig[] },
): NearestStartPlan => {
  const transitionSec = result.entry_lead_ms / 1000;
  const members = result.devices.map((row): NearestStartMemberPlan => {
    const from = poseOf(row.current_HPY as Hpy);
    const target = { ...from };
    const object = options.objects.find((item) => item.id === row.model_id);
    const axes = AXES.flatMap((axis, index): NearestStartAxisMove[] => {
      const move = result.entry_moves.find((item) => item.model_id === row.model_id && item.axisIndex === index);
      if (!move) return [];
      const to = row.join_HPY[index] ?? from[axis];
      target[axis] = to;
      // 设备没有的轴：pos 填实时值，速度、加减速度填 0，C++ 不下发（算法内部为了核对给的是 0.1）
      const exists = object === undefined || object.enabledVirtualAxes.includes(axis);
      const entryMove = exists
        ? { pos: move.pos, vel: move.vel, accVel: move.accVel, decVel: move.decVel }
        : { pos: move.pos, vel: 0, accVel: 0, decVel: 0 };
      return [
        {
          axis,
          from: from[axis],
          to,
          velocity: entryMove.vel,
          acceleration: entryMove.accVel,
          deceleration: entryMove.decVel,
          durationSec: transitionSec,
          joinVelocity: row.join_velocity_HPY[index] ?? 0,
          entryMove,
        },
      ];
    });
    const moving = row.axes.some((axis) => axis.kind !== "in_place");
    return {
      objectId: row.model_id,
      from,
      target,
      axes,
      arrivalSec: moving ? transitionSec : 0,
      waitSec: moving ? 0 : transitionSec,
    };
  });
  return {
    forced: false,
    nearest: options.nearest,
    direction: result.reverse ? -1 : 1,
    startMode: options.nearest ? "nearest" : "boundary",
    targetFrameMs: result.selected_curve_time_ms,
    transitionSec,
    prepareTimeMs: Math.ceil(result.entry_lead_ms),
    loopCount: options.loopCount,
    motorLimitScale: null,
    members,
  };
};

const planNonforcedStart = (
  input: NearestStartInput,
  models: AlgorithmModel[],
  runtime: RuntimeModelState[],
): NearestStartPlan => {
  const specified = input.specifiedFrameMs;
  const result = calculateNonforcedEntry({
    command: {
      trajectory_run: false,
      reverse: input.reverse,
      nearest_start: input.nearest || specified !== undefined,
      use_specified_time: specified !== undefined,
      ...(specified !== undefined ? { specified_time_ms: referenceFrameIn(models, specified) } : {}),
      stopped_time_ms:
        input.referenceFrameMs === undefined ? null : referenceFrameIn(models, input.referenceFrameMs),
      loop_count: input.loopCount,
    },
    settings: ALGORITHM_SETTINGS,
    models: models.map((model) =>
      withStroke(model, input.objects, runtime.find((state) => state.model_id === model.model_id)!.position_HPY),
    ),
    runtime: { models: runtime },
  });
  if (result.status !== "planned") throw nonforcedFailure(result);
  return toNonforcedStartPlan(result, input);
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
  let plan: NearestStartPlan;
  if (!input.forced) {
    plan = planNonforcedStart(input, models, runtime);
  } else {
    const modelsAtDefaultSpeed = models.map((model) => {
      const [h, p, y] = model.default_velocity_HPY;
      return { ...model, max_velocity_HPY: [h, p, y] satisfies Hpy };
    });
    const specified = input.specifiedFrameMs;
    const result = calculateNearestEntry({
      command: {
        trajectory_run: true,
        reverse: input.reverse,
        nearest_start: input.nearest || specified !== undefined,
        use_specified_time: specified !== undefined,
        ...(specified !== undefined ? { specified_time_ms: referenceFrameIn(models, specified) } : {}),
        stopped_time_ms:
          input.referenceFrameMs === undefined ? null : referenceFrameIn(models, input.referenceFrameMs),
        loop_count: input.loopCount,
      },
      settings: ALGORITHM_SETTINGS,
      models: modelsAtDefaultSpeed,
      runtime: { models: runtime },
    });
    plan = toNearestStartPlan(result, input);
  }
  // 整条序列只有一刻时模型向后补了 1ms，接入帧不超过序列总时长
  return { ...plan, targetFrameMs: Math.min(plan.targetFrameMs, Math.max(0, input.resolved.totalMs)) };
};

/**
 * 准备开始后 elapsedMs 时各成员的位姿。强制：所有移动轴同时停到目标；
 * 非强制：按实际下发的准备 Move 回放，到接入帧时正好接上曲线（可能还在运动）。
 */
export const nearestStartPosesAt = (
  plan: NearestStartPlan,
  elapsedMs: number,
): Map<number, ModelPose> => {
  const tSec = Math.max(0, elapsedMs) / 1000;
  const poses = new Map<number, ModelPose>();
  for (const member of plan.members) {
    const pose = { ...member.from };
    for (const move of member.axes) {
      pose[move.axis] = move.entryMove
        ? entryMovePositionAt(move.from, move.entryMove, tSec)
        : pointToPointPositionAt(move.from, move.to, move, tSec);
    }
    poses.set(member.objectId, pose);
  }
  return poses;
};
