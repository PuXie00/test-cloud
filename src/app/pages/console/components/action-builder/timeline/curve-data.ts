import {
  axisMotionValueAt,
  axisMotionVelocityAt,
} from "@/app/project/action-sequence/axis-motion";
import {
  objectAxisMotions,
  uncontrolledAxesOf,
  type PoseJunctionKind,
  type ResolvedActionSequence,
  type ResolvedAxisMotion,
  type ResolvedMotionSegment,
  type ResolvedPosePoint,
} from "@/app/project/action-sequence/resolve-sequence";
import { sequenceObjectIds } from "@/app/project/action-sequence/sequence-object-ids";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import {
  axisMotionIssues,
  type AxisMotionIssue,
} from "@/app/project/action-sequence/validate-sequence";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { VIRTUAL_AXIS_IDS, type ControlledObject } from "./timeline-data";

/**
 * 曲线视图的数据：一个物体一根轴一条曲线，取自 resolve 出来的轴运动
 * （和 3D 预览、下发 C++/PLC 同一套计算）。位置、速度都按 axisMotionValueAt /
 * axisMotionVelocityAt 采样，以后区间加别的曲线类型也能直接画。
 */

export type TimelineViewMode = "tracks" | "curves";

/** 曲线视图一次看一种：位置或速度 */
export type CurveGraph = "position" | "velocity";

export const CURVE_GRAPHS: readonly { id: CurveGraph; label: string }[] = [
  { id: "position", label: "位置" },
  { id: "velocity", label: "速度" },
];

/** 一段曲线：轴从一个设定值走到下一个（中间位姿不设定时跨过它们） */
export type CurveSpan = {
  motion: ResolvedAxisMotion;
  /** 算不出形状（参数不对、经过速度放不下、有行程却不动）时为 false，按直线画 */
  drawable: boolean;
  /** 变速的拐点（梯形的加速结束、减速开始）；采样一定取到这些时刻，折角才画得准 */
  cornersMs: readonly number[];
  /** 和序列校验同一套规则查出的问题 */
  issues: readonly AxisMotionIssue[];
};

/** set：位姿设定了这根轴，可以拖；pass：位姿里不设定，曲线从这里经过；preset：预设生成 */
export type CurveKeyKind = "set" | "pass" | "preset";

export type CurveKey = {
  /** 点它选中的块：位姿块本身；预设生成的点是预设块 */
  blockId: string | null;
  sourceRef: string;
  atMs: number;
  value: number;
  kind: CurveKeyKind;
};

/** 位姿处的衔接速度（带方向，单位/秒） */
export type CurveJunction = {
  blockId: string | null;
  sourceRef: string;
  atMs: number;
  velocity: number;
  kind: PoseJunctionKind;
};

export type AxisCurve = {
  objectId: number;
  axis: VirtualAxisId;
  /** 第一个点之前保持首值，最后一个点之后保持末值 */
  startMs: number;
  endMs: number;
  firstValue: number;
  lastValue: number;
  spans: CurveSpan[];
  keys: CurveKey[];
  junctions: CurveJunction[];
  maxVelocity?: number;
  range?: { min: number; max: number };
};

export type CurveSample = { value: number; velocity: number };

export type CurveRange = { min: number; max: number };

export type CurveScales = { position: CurveRange; velocity: CurveRange };

const enabledAxesOf = (object: ControlledObject | undefined): readonly VirtualAxisId[] =>
  object?.enabledAxes?.length ? object.enabledAxes : VIRTUAL_AXIS_IDS;

/** 序列里的物体按 id 排，和轨道的行一样 */
export const curveRowObjectIds = (sequence: ActionSequenceConfig): number[] =>
  [...sequenceObjectIds(sequence)].filter((id) => Number.isFinite(id)).sort((a, b) => a - b);

/** 曲线显示选中的物体；没选序列里的物体时显示全部 */
export const visibleCurveObjectIds = (
  rowObjectIds: readonly number[],
  selectedObjectIds: readonly number[],
): number[] => {
  const picked = rowObjectIds.filter((id) => selectedObjectIds.includes(id));
  return picked.length > 0 ? picked : [...rowObjectIds];
};

const hasCurve = (
  resolved: ResolvedActionSequence,
  object: ControlledObject | undefined,
  objectId: number,
  axis: VirtualAxisId,
): boolean =>
  enabledAxesOf(object).includes(axis) &&
  !uncontrolledAxesOf(resolved, objectId).includes(axis) &&
  (resolved.posesByObject.get(objectId)?.length ?? 0) > 0;

/** 这些物体里至少有一个受这条序列控制的虚轴 */
export const availableCurveAxes = (
  resolved: ResolvedActionSequence,
  objectIds: readonly number[],
  objects: readonly ControlledObject[],
): VirtualAxisId[] => {
  const objectById = new Map(objects.map((object) => [object.id, object]));
  return VIRTUAL_AXIS_IDS.filter((axis) =>
    objectIds.some((objectId) => hasCurve(resolved, objectById.get(objectId), objectId, axis)),
  );
};

const isDrawable = (motion: ResolvedAxisMotion): boolean => {
  if (motion.to === motion.from) return true;
  if (motion.profile.kind === "idle") return false;
  try {
    axisMotionValueAt(motion, (motion.startMs + motion.endMs) / 2);
    axisMotionVelocityAt(motion, (motion.startMs + motion.endMs) / 2);
    return true;
  } catch {
    return false;
  }
};

const cornersOf = (motion: ResolvedAxisMotion): number[] => {
  if (motion.profile.kind !== "trapezoid" || motion.to === motion.from) return [];
  const { accelMs, decelMs } = motion.profile.params;
  return [motion.startMs + accelMs, motion.endMs - decelMs].filter(
    (atMs) => atMs > motion.startMs && atMs < motion.endMs,
  );
};

const keyKindOf = (point: ResolvedPosePoint, axis: VirtualAxisId): CurveKeyKind => {
  if (point.sourceKind !== "pose") return "preset";
  return point.unsetAxes?.includes(axis) ? "pass" : "set";
};

/** 衔接速度的方向跟着进来或出去的那段曲线 */
const junctionVelocity = (
  point: ResolvedPosePoint,
  speed: number,
  spans: readonly CurveSpan[],
): number => {
  if (speed === 0) return 0;
  const motion =
    spans.find((span) => span.motion.toRef === point.sourceRef)?.motion ??
    spans.find((span) => span.motion.fromRef === point.sourceRef)?.motion;
  if (!motion || motion.to === motion.from) return speed;
  return Math.sign(motion.to - motion.from) * speed;
};

const segmentsByObject = (
  segments: readonly ResolvedMotionSegment[],
): Map<number, ResolvedMotionSegment[]> => {
  const grouped = new Map<number, ResolvedMotionSegment[]>();
  for (const segment of segments) {
    const list = grouped.get(segment.objectId);
    if (list) list.push(segment);
    else grouped.set(segment.objectId, [segment]);
  }
  return grouped;
};

/** 各物体在这根轴上的曲线；没启用、不受序列控制的轴不画 */
export const buildAxisCurves = ({
  resolved,
  objectIds,
  axis,
  objects,
}: {
  resolved: ResolvedActionSequence;
  objectIds: readonly number[];
  axis: VirtualAxisId;
  objects: readonly ControlledObject[];
}): AxisCurve[] => {
  const objectById = new Map(objects.map((object) => [object.id, object]));
  const segments = segmentsByObject(resolved.segments);
  return objectIds.flatMap((objectId) => {
    const object = objectById.get(objectId);
    if (!hasCurve(resolved, object, objectId, axis)) return [];
    const points = resolved.posesByObject.get(objectId) ?? [];
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return [];
    const limit = {
      maxVelocity: object?.maxSpeedByAxis?.[axis],
      minAccelTime: object?.minAccelTimeByAxis?.[axis],
    };
    const spans: CurveSpan[] = objectAxisMotions(segments.get(objectId) ?? [], axis)
      .filter((motion) => motion.durationMs > 0)
      .map((motion) => ({
        motion,
        drawable: isDrawable(motion),
        cornersMs: cornersOf(motion),
        issues: axisMotionIssues(motion, limit),
      }));
    const keys: CurveKey[] = points
      .filter((point) => point.visible)
      .map((point) => ({
        blockId: point.sourceBlockId,
        sourceRef: point.sourceRef,
        atMs: point.atMs,
        value: point.pose[axis],
        kind: keyKindOf(point, axis),
      }));
    const junctions: CurveJunction[] = points.flatMap((point) => {
      const junction = point.junctions?.[axis];
      if (!junction || !point.visible) return [];
      return [
        {
          blockId: point.sourceBlockId,
          sourceRef: point.sourceRef,
          atMs: point.atMs,
          velocity: junctionVelocity(point, junction.speed, spans),
          kind: junction.kind,
        },
      ];
    });
    const maxVelocity = object?.maxSpeedByAxis?.[axis];
    const range = object?.rangeByAxis?.[axis];
    return [
      {
        objectId,
        axis,
        startMs: first.atMs,
        endMs: last.atMs,
        firstValue: first.pose[axis],
        lastValue: last.pose[axis],
        spans,
        keys,
        junctions,
        ...(maxVelocity !== undefined ? { maxVelocity } : {}),
        ...(range !== undefined ? { range } : {}),
      },
    ];
  });
};

/** 一段曲线在某一时刻的位置和速度；算不出形状的段按直线，速度为 NaN */
export const spanSampleAt = (span: CurveSpan, atMs: number): CurveSample => {
  const { motion } = span;
  if (!span.drawable) {
    const progress = motion.durationMs > 0 ? (atMs - motion.startMs) / motion.durationMs : 1;
    const clamped = Math.min(1, Math.max(0, progress));
    return { value: motion.from + (motion.to - motion.from) * clamped, velocity: Number.NaN };
  }
  return { value: axisMotionValueAt(motion, atMs), velocity: axisMotionVelocityAt(motion, atMs) };
};

/** 曲线在某一时刻的位置和速度（首个点之前、最后一个点之后不动） */
export const curveSampleAt = (curve: AxisCurve, atMs: number): CurveSample => {
  if (atMs <= curve.startMs) return { value: curve.firstValue, velocity: 0 };
  for (const span of curve.spans) {
    if (atMs >= span.motion.endMs) continue;
    if (atMs < span.motion.startMs) return { value: span.motion.from, velocity: 0 };
    return spanSampleAt(span, atMs);
  }
  return { value: curve.lastValue, velocity: 0 };
};

/** 画一段曲线要取的时刻：可见范围内的两端、拐点，中间每 stepMs 一个；不动和直线段只取两端 */
export const spanSampleTimes = (
  span: CurveSpan,
  fromMs: number,
  toMs: number,
  stepMs: number,
): number[] => {
  const start = Math.max(span.motion.startMs, fromMs);
  const end = Math.min(span.motion.endMs, toMs);
  if (end < start) return [];
  const times = new Set<number>([start, end]);
  if (span.drawable && span.motion.to !== span.motion.from) {
    for (const corner of span.cornersMs) {
      if (corner > start && corner < end) times.add(corner);
    }
    const step = Math.max(stepMs, 1);
    for (let atMs = Math.floor(start / step) * step + step; atMs < end; atMs += step) {
      times.add(atMs);
    }
  }
  return [...times].sort((left, right) => left - right);
};

const FIT_SAMPLES = 16;
/** 最大速度不超过峰值速度的这么多倍时，纵轴把最大速度线也包进来 */
const LIMIT_FIT_RATIO = 1.5;

const padRange = (min: number, max: number): CurveRange => {
  const span = max - min;
  const pad = span > 0 ? span * 0.1 : Math.max(Math.abs(max) * 0.1, 1);
  return { min: min - pad, max: max + pad };
};

/** 纵轴按全部曲线适配（不随左右平移变）；速度总包含 0 */
export const fitCurveScales = (curves: readonly AxisCurve[]): CurveScales => {
  let positionMin = Number.POSITIVE_INFINITY;
  let positionMax = Number.NEGATIVE_INFINITY;
  let velocityMin = 0;
  let velocityMax = 0;
  for (const curve of curves) {
    for (const value of [curve.firstValue, curve.lastValue, ...curve.keys.map((key) => key.value)]) {
      positionMin = Math.min(positionMin, value);
      positionMax = Math.max(positionMax, value);
    }
    for (const span of curve.spans) {
      const { motion } = span;
      const times = [motion.startMs, motion.endMs, ...span.cornersMs];
      if (span.drawable) {
        for (let index = 1; index < FIT_SAMPLES; index += 1) {
          times.push(motion.startMs + (motion.durationMs * index) / FIT_SAMPLES);
        }
      }
      for (const atMs of times) {
        const sample = spanSampleAt(span, atMs);
        positionMin = Math.min(positionMin, sample.value);
        positionMax = Math.max(positionMax, sample.value);
        if (!Number.isFinite(sample.velocity)) continue;
        velocityMin = Math.min(velocityMin, sample.velocity);
        velocityMax = Math.max(velocityMax, sample.velocity);
      }
    }
  }
  if (!Number.isFinite(positionMin)) {
    positionMin = 0;
    positionMax = 0;
  }
  // 速度离上限不远时把上限线也框进来，看得出还差多少
  for (const curve of curves) {
    const limit = curve.maxVelocity;
    if (!limit || !(limit > 0)) continue;
    if (velocityMax > 0 && limit <= velocityMax * LIMIT_FIT_RATIO) {
      velocityMax = Math.max(velocityMax, limit);
    }
    if (velocityMin < 0 && limit <= -velocityMin * LIMIT_FIT_RATIO) {
      velocityMin = Math.min(velocityMin, -limit);
    }
  }
  return {
    position: padRange(positionMin, positionMax),
    velocity: padRange(velocityMin, velocityMax),
  };
};

const roundToStep = (value: number, step: number): number =>
  Number((Math.round(value / step) * step).toFixed(10));

/** 刻度：1、2、5×10ⁿ 的整数倍，最多 maxCount 段 */
export const niceTicks = (min: number, max: number, maxCount: number): number[] => {
  if (!(max > min) || !(maxCount >= 1)) return [];
  const raw = (max - min) / maxCount;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((item) => item >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) {
    ticks.push(roundToStep(value, step));
  }
  return ticks;
};

/** 拖值的取整步长：每像素对应的值往下取 1、2、5×10ⁿ，不小于工程精度 0.1 */
export const dragValueStep = (valuePerPx: number): number => {
  if (!(valuePerPx > 0) || !Number.isFinite(valuePerPx)) return 0.1;
  const power = 10 ** Math.floor(Math.log10(valuePerPx));
  const step = [5, 2, 1].map((factor) => factor * power).find((item) => item <= valuePerPx) ?? power;
  return Math.max(0.1, roundToStep(step, power / 10));
};

export const roundDragValue = (value: number, step: number): number => roundToStep(value, step);

const JUNCTION_KIND_TEXT: Record<PoseJunctionKind, string> = {
  auto: "自动",
  manual: "手填",
  edge: "序列起止",
  reverse: "折返",
  hold: "前后有一段不动",
  seam: "循环接回起点",
};

export const junctionKindText = (kind: PoseJunctionKind): string => JUNCTION_KIND_TEXT[kind];

/** 曲线上标红的原因，用词和运动区间属性里一致 */
export const curveIssueText = (
  issue: AxisMotionIssue,
  format: { speed: (value: number) => string; acceleration: (value: number) => string },
): string => {
  if (issue.code === "idle-on-moving-axis") return "这段有行程，曲线却设成了不动";
  if (issue.code === "missing-motion-limit") return "物体没有配置最大速度或最短加减速时间";
  if (issue.code === "insufficient-cruise") return "加速与减速时间之和不小于区间时长";
  if (issue.code === "pass-speed-infeasible") return "经过速度太快，这段行程放不下进出变速";
  if (issue.code === "limit-exceeded") {
    return `峰值速度 ${format.speed(issue.value)} 超过上限 ${format.speed(issue.limit)}`;
  }
  return `加减速度 ${format.acceleration(issue.value)} 超过上限 ${format.acceleration(issue.limit)}`;
};

/** 曲线旁边的简短标注 */
export const curveIssueShortText = (
  issue: AxisMotionIssue,
  speedNumber: (value: number) => string,
): string => {
  if (issue.code === "limit-exceeded") return `超速 ${speedNumber(issue.value)}`;
  if (issue.code === "acceleration-exceeded") return "加减速超限";
  if (issue.code === "pass-speed-infeasible") return "经过速度放不下";
  if (issue.code === "insufficient-cruise") return "加减速时间不够";
  if (issue.code === "idle-on-moving-axis") return "曲线设成了不动";
  return "缺少速度上限";
};
