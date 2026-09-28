import type { VirtualAxisId } from "../project-document-types";
import {
  AXES,
  mapForcedFrame,
  memberTimeline,
  sampleMember,
  sharedKeyframes,
  type MemberTimeline,
} from "./nearest-start-frames";
import {
  minimumMotionProfile,
  motorVelocityUpperBound,
  pointToPointPositionAt,
  scaleMotionParameters,
  type AxisVad,
  type HpyPose,
  type NearestStartGeometry,
} from "./nearest-start-motion";
import type { ResolvedActionSequence } from "./resolve-sequence";
import type { ModelPose } from "./types";

/**
 * 启动接入算法，逐项对齐 python/就近位置计算.py：
 * 第一步选目标帧（强制：就近粗搜100ms/细搜10ms；非强制：沿方向取下一公共关键帧），
 * 第二步算从当前位置到目标位姿的 V/A/D 与时间（强制：默认参数独立到位后等待；
 * 非强制：最大参数同步到达并按电机速度上界统一降速）。
 */

export const NEAREST_COARSE_STEP_MS = 100;
export const NEAREST_FINE_STEP_MS = 10;

export type { AxisVad, NearestStartGeometry } from "./nearest-start-motion";

export type NearestStartMember = {
  objectId: number;
  activeAxes: readonly VirtualAxisId[];
  current: ModelPose;
  /** 强制：正常速度与默认加速度（减速度按 PLC 取同一加速度）；非强制：就近搜索只用 velocity */
  defaultVad: Record<VirtualAxisId, AxisVad>;
  /** 非强制 Move 的最大 V/A/D；强制轨迹只用 acceleration 做 xSafe 判定 */
  maxVad: Record<VirtualAxisId, AxisVad>;
  maxMotorVelocity: number;
  geometry: NearestStartGeometry;
};

export type NearestStartInput = {
  resolved: ResolvedActionSequence;
  members: readonly NearestStartMember[];
  forced: boolean;
  nearest: boolean;
  reverse: boolean;
  /** 仅强制有效：false 时超出单模型范围沿运行方向按该模型首末帧周期映射 */
  loopOnce: boolean;
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
  axes: NearestStartAxisMove[];
  arrivalSec: number;
  waitSec: number;
};

export type NearestStartPlan = {
  forced: boolean;
  nearest: boolean;
  direction: 1 | -1;
  startMode: "nearest" | "boundary";
  targetFrameMs: number;
  transitionSec: number;
  /** 仅强制：各活动轴 |目标−当前| ≤ 曲线速度²/(2·最大加速度) 才为 true */
  xSafe: boolean | null;
  motorLimitScale: number | null;
  members: NearestStartMemberPlan[];
};

type Member = NearestStartMember & { timeline: MemberTimeline };

const DISTANCE_EPSILON = 1e-12;
const FRAME_EPSILON = 1e-9;

const hpy = (pose: ModelPose): HpyPose => ({ h: pose.v1, p: pose.v2, y: pose.v3 });

const withInactiveAligned = (member: NearestStartMember, target: ModelPose): ModelPose => {
  const aligned = { ...member.current };
  for (const axis of AXES) {
    if (!member.activeAxes.includes(axis)) aligned[axis] = target[axis];
  }
  return aligned;
};

const prepareMembers = (input: NearestStartInput): Member[] => {
  const members: Member[] = [];
  for (const member of input.members) {
    if (member.activeAxes.length === 0) continue;
    const timeline = memberTimeline(input.resolved, member.objectId);
    if (!timeline) continue;
    members.push({ ...member, timeline });
  }
  if (members.length === 0) throw new Error("动作序列没有可接入的成员");
  return members;
};

type ForcedFrame = {
  frameMs: number;
  moveTime: number;
  safe: boolean;
  targets: Map<number, ModelPose>;
};

const evaluateForcedFrame = (
  members: readonly Member[],
  frameMs: number,
  direction: 1 | -1,
  loopOnce: boolean,
): ForcedFrame => {
  let moveTime = 0;
  let safe = true;
  const targets = new Map<number, ModelPose>();
  for (const member of members) {
    const sample = sampleMember(
      member.timeline,
      mapForcedFrame(member.timeline, frameMs, direction, loopOnce),
    );
    targets.set(member.objectId, sample.pose);
    for (const axis of member.activeAxes) {
      const delta = Math.abs(sample.pose[axis] - member.current[axis]);
      const curveVelocity = sample.velocityPer100ms[axis];
      const allowed = (curveVelocity * curveVelocity) / (2 * member.maxVad[axis].acceleration);
      moveTime = Math.max(moveTime, delta / member.defaultVad[axis].velocity);
      safe = safe && delta <= allowed;
    }
  }
  return { frameMs, moveTime, safe, targets };
};

const scanForced = (
  evaluate: (frameMs: number) => ForcedFrame,
  start: number,
  end: number,
  step: number,
  best: ForcedFrame | null,
): ForcedFrame => {
  let current = best;
  const epsilon = Math.abs(step) * 1e-9;
  let frame = start;
  while ((step > 0 && frame <= end + epsilon) || (step < 0 && frame >= end - epsilon)) {
    const candidate = evaluate(frame);
    if (current === null || candidate.moveTime < current.moveTime) current = candidate;
    frame += step;
  }
  if (!current) throw new Error("强制轨迹没有可评估的时间点");
  return current;
};

const selectForcedFrame = (
  members: readonly Member[],
  input: NearestStartInput,
  direction: 1 | -1,
): ForcedFrame => {
  for (const member of members) {
    for (const axis of member.activeAxes) {
      if (!(member.defaultVad[axis].velocity > 0)) {
        throw new Error(`模型${member.objectId}的${axisName(axis)}轴正常速度必须大于0`);
      }
      if (!(member.maxVad[axis].acceleration > 0)) {
        throw new Error(`模型${member.objectId}的${axisName(axis)}轴最大加速度必须大于0`);
      }
    }
  }
  const globalStart = Math.min(...members.map((member) => member.timeline.firstMs));
  const globalEnd = Math.max(...members.map((member) => member.timeline.lastMs));
  const evaluate = (frameMs: number) =>
    evaluateForcedFrame(members, frameMs, direction, input.loopOnce);

  if (!input.nearest) return evaluate(direction > 0 ? globalStart : globalEnd);

  const coarse = NEAREST_COARSE_STEP_MS;
  const fine = NEAREST_FINE_STEP_MS;
  let best =
    direction > 0
      ? scanForced(evaluate, globalStart, globalEnd, coarse, null)
      : scanForced(evaluate, globalEnd, globalStart, -coarse, null);
  const fineStart = Math.max(globalStart, best.frameMs - coarse);
  const fineEnd = Math.min(globalEnd, best.frameMs + coarse);
  best =
    direction > 0
      ? scanForced(evaluate, fineStart, fineEnd, fine, best)
      : scanForced(evaluate, fineEnd, fineStart, -fine, best);
  return best;
};

const axisName = (axis: VirtualAxisId): string => (axis === "v1" ? "H" : axis === "v2" ? "P" : "Y");

const forcedMotion = (members: readonly Member[], frame: ForcedFrame, direction: 1 | -1, nearest: boolean): NearestStartPlan => {
  const plans: NearestStartMemberPlan[] = members.map((member) => {
    const target = frame.targets.get(member.objectId)!;
    const from = withInactiveAligned(member, target);
    const axes: NearestStartAxisMove[] = [];
    for (const axis of member.activeAxes) {
      const distance = Math.abs(target[axis] - from[axis]);
      if (distance <= DISTANCE_EPSILON) continue;
      const velocity = member.defaultVad[axis].velocity;
      const acceleration = member.defaultVad[axis].acceleration;
      if (Math.min(velocity, acceleration) <= 0) {
        throw new Error(`模型${member.objectId}的${axisName(axis)}轴默认速度、加速度必须大于0`);
      }
      const { time } = minimumMotionProfile(distance, velocity, acceleration, acceleration);
      axes.push({
        axis,
        from: from[axis],
        to: target[axis],
        velocity,
        acceleration,
        deceleration: acceleration,
        durationSec: time,
      });
    }
    const arrivalSec = Math.max(0, ...axes.map((move) => move.durationSec));
    return { objectId: member.objectId, from, target, axes, arrivalSec, waitSec: 0 };
  });
  const transitionSec = Math.max(0, ...plans.map((plan) => plan.arrivalSec));
  if (!Number.isFinite(transitionSec)) throw new Error("强制轨迹准备时间超出数值范围");
  for (const plan of plans) plan.waitSec = Math.max(0, transitionSec - plan.arrivalSec);
  return {
    forced: true,
    nearest,
    direction,
    startMode: nearest ? "nearest" : "boundary",
    targetFrameMs: frame.frameMs,
    transitionSec,
    xSafe: frame.safe,
    motorLimitScale: null,
    members: plans,
  };
};

const positionsAt = (members: readonly Member[], frameMs: number): Map<number, ModelPose> =>
  new Map(members.map((member) => [member.objectId, sampleMember(member.timeline, frameMs).pose]));

const nonForcedCandidates = (
  members: readonly Member[],
  input: NearestStartInput,
  direction: 1 | -1,
): number[] => {
  const boundaries = sharedKeyframes(members.map((member) => member.timeline));
  const globalStart = boundaries[0]!;
  const globalEnd = boundaries[boundaries.length - 1]!;
  if (!input.nearest) return [direction > 0 ? globalStart : globalEnd];

  let searchOrigin: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const passes: Array<[number, number | null]> = [
    [NEAREST_COARSE_STEP_MS, null],
    [NEAREST_FINE_STEP_MS, NEAREST_COARSE_STEP_MS],
  ];
  for (const [step, radius] of passes) {
    const center: number | null = searchOrigin;
    const left: number = radius === null || center === null ? 0 : Math.max(0, center - radius);
    const right: number =
      radius === null || center === null ? globalEnd : Math.min(globalEnd, center + radius);
    const frames = new Set<number>([left, right]);
    for (const frame of boundaries) if (left <= frame && frame <= right) frames.add(frame);
    const count = Math.floor((right - left) / step) + 1;
    for (let index = 0; index < count; index += 1) frames.add(left + index * step);
    const ordered: number[] = [...frames].sort((a, b) => (direction > 0 ? a - b : b - a));
    for (const frame of ordered) {
      const positions = positionsAt(members, frame);
      let score = 0;
      for (const member of members) {
        for (const axis of member.activeAxes) {
          const delta = Math.abs(positions.get(member.objectId)![axis] - member.current[axis]);
          const velocity = member.defaultVad[axis].velocity;
          const moveTime =
            delta <= DISTANCE_EPSILON ? 0 : velocity > 0 ? delta / velocity : Number.POSITIVE_INFINITY;
          score = Math.max(score, moveTime);
        }
      }
      if (score < bestScore) {
        bestScore = score;
        searchOrigin = frame;
      }
    }
    if (searchOrigin === null) {
      throw new Error("无法搜索最近曲线时间：正常速度为0或定位计算超出数值范围");
    }
  }
  const origin = searchOrigin!;
  const candidates = boundaries
    .filter((frame) => (frame - origin) * direction >= -FRAME_EPSILON)
    .filter((frame) => Math.abs(frame - origin) > FRAME_EPSILON)
    .sort((a, b) => (direction > 0 ? a - b : b - a));
  if (candidates.length > 0) return candidates;
  const terminal = direction > 0 ? globalEnd : globalStart;
  if (Math.abs(origin - terminal) > FRAME_EPSILON) {
    throw new Error("当前方向没有候选关键帧，不选择反方向帧");
  }
  return [terminal];
};

const nonForcedMotion = (
  members: readonly Member[],
  frameMs: number,
): { plans: NearestStartMemberPlan[]; transitionSec: number; motorLimitScale: number } => {
  const targets = positionsAt(members, frameMs);
  type AxisDraft = { axis: VirtualAxisId; distance: number; peak: number; time: number; vad: AxisVad };
  const drafts = new Map<number, { from: ModelPose; target: ModelPose; axes: AxisDraft[] }>();
  const minimumTimes: number[] = [];

  for (const member of members) {
    const target = targets.get(member.objectId)!;
    const from = withInactiveAligned(member, target);
    const axes: AxisDraft[] = [];
    for (const axis of member.activeAxes) {
      const distance = Math.abs(target[axis] - from[axis]);
      const limit = member.maxVad[axis];
      const { peak, time } = minimumMotionProfile(
        distance,
        limit.velocity,
        limit.acceleration,
        limit.deceleration,
      );
      if (!Number.isFinite(peak) || !Number.isFinite(time)) {
        throw new Error(`模型${member.objectId}的运动计算超出数值范围`);
      }
      axes.push({
        axis,
        distance,
        peak,
        time,
        vad: { velocity: peak, acceleration: limit.acceleration, deceleration: limit.deceleration },
      });
      minimumTimes.push(time);
    }
    drafts.set(member.objectId, { from, target, axes });
  }

  let synchronizedTime = Math.max(0, ...minimumTimes);
  for (const draft of drafts.values()) {
    for (const axis of draft.axes) {
      if (axis.distance <= DISTANCE_EPSILON) continue;
      if (synchronizedTime > axis.time) {
        axis.vad = scaleMotionParameters(axis.vad, axis.time / synchronizedTime);
      }
      const { velocity, acceleration, deceleration } = axis.vad;
      if (![velocity, acceleration, deceleration].every((value) => Number.isFinite(value) && value > 0)) {
        throw new Error("同步后的移动轴速度、加减速度超出数值范围");
      }
    }
  }

  let motorScale = 1;
  for (const member of members) {
    const draft = drafts.get(member.objectId)!;
    const limit = member.maxMotorVelocity;
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error(`模型${member.objectId}的最大电机速度必须为有限正数`);
    }
    const velocity: HpyPose = { h: 0, p: 0, y: 0 };
    for (const axis of draft.axes) {
      if (axis.distance <= DISTANCE_EPSILON) continue;
      velocity[axis.axis === "v1" ? "h" : axis.axis === "v2" ? "p" : "y"] = axis.vad.velocity;
    }
    const bound = motorVelocityUpperBound(
      member.objectId,
      member.geometry,
      hpy(draft.from),
      hpy(draft.target),
      velocity,
    );
    if (!Number.isFinite(bound) || bound < 0) {
      throw new Error(`模型${member.objectId}的电机速度上界无效`);
    }
    if (bound > 0) motorScale = Math.min(motorScale, limit / (bound * (1 + 1e-9)));
  }

  if (motorScale < 1) {
    for (const draft of drafts.values()) {
      for (const axis of draft.axes) {
        if (axis.distance <= DISTANCE_EPSILON) continue;
        axis.vad = scaleMotionParameters(axis.vad, motorScale);
        if (Math.min(axis.vad.velocity, axis.vad.acceleration, axis.vad.deceleration) <= 0) {
          throw new Error("电机限速要求的参数过小，超出浮点可计算范围");
        }
      }
    }
    synchronizedTime /= motorScale;
    if (!Number.isFinite(synchronizedTime)) throw new Error("限速后的运行时间超出数值范围");
  }

  const plans = members.map((member): NearestStartMemberPlan => {
    const draft = drafts.get(member.objectId)!;
    const axes = draft.axes
      .filter((axis) => axis.distance > DISTANCE_EPSILON)
      .map((axis) => ({
        axis: axis.axis,
        from: draft.from[axis.axis],
        to: draft.target[axis.axis],
        ...axis.vad,
        durationSec: synchronizedTime,
      }));
    return {
      objectId: member.objectId,
      from: draft.from,
      target: draft.target,
      axes,
      arrivalSec: axes.length > 0 ? synchronizedTime : 0,
      waitSec: axes.length > 0 ? 0 : synchronizedTime,
    };
  });
  return { plans, transitionSec: synchronizedTime, motorLimitScale: motorScale };
};

export const planNearestStart = (input: NearestStartInput): NearestStartPlan => {
  const direction: 1 | -1 = input.reverse ? -1 : 1;
  const members = prepareMembers(input);

  if (input.forced) {
    return forcedMotion(members, selectForcedFrame(members, input, direction), direction, input.nearest);
  }

  const rejected: string[] = [];
  for (const frameMs of nonForcedCandidates(members, input, direction)) {
    try {
      const motion = nonForcedMotion(members, frameMs);
      return {
        forced: false,
        nearest: input.nearest,
        direction,
        startMode: input.nearest ? "nearest" : "boundary",
        targetFrameMs: frameMs,
        transitionSec: motion.transitionSec,
        xSafe: null,
        motorLimitScale: motion.motorLimitScale,
        members: motion.plans,
      };
    } catch (error) {
      rejected.push(`${frameMs}ms：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`非强制轨迹没有可执行的候选帧：${rejected.join("；")}`);
};

/** 过渡开始后 elapsedMs 时各成员的位姿；强制轨迹先到的成员原地等待。 */
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
