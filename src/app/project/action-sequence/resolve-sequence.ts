import type { VirtualAxisId } from "../project-document-types";
import { axisMotionValueAt } from "./axis-motion";
import { isAxisSet, unsetAxesOf } from "./keyframe-pose";
import {
  cloneAxisProfiles,
  cloneMotionProfile,
  createDefaultAxisProfile,
  createDefaultAxisProfiles,
  evaluateMotionProfile,
  hasMotionBoundary,
  syncAxisProfileToTravel,
} from "./motion-profile";
import { getPresetDefinition, resolvePreset } from "./preset-registry";
import type {
  ActionSequenceConfig,
  DynamicPresetBlock,
  InstructionBlock,
  ModelPose,
  MotionProfile,
  MotionSegmentConfig,
  MotionSegmentSettings,
} from "./types";

export type ResolvedPosePoint = {
  sourceRef: string;
  sourceBlockId: string | null;
  sourceKind: "pose" | "static-preset" | "dynamic-preset";
  objectId: number;
  atMs: number;
  pose: ModelPose;
  editable: boolean;
  visible: boolean;
  /** 位姿块里不设定的轴；pose 里对应的值是按前后设定值之间的曲线算出的经过值 */
  unsetAxes?: readonly VirtualAxisId[];
  /** 位姿块里手填的经过速度（只含设定了值的轴） */
  passSpeeds?: Partial<Record<VirtualAxisId, number>>;
  /** 各设定轴在这一帧的衔接速度及原因 */
  junctions?: Partial<Record<VirtualAxisId, PoseJunction>>;
};

/**
 * 衔接速度的来由：auto 自动（调和平均）、manual 手填、edge 序列起止、reverse 折返、
 * hold 前后有一段不动、per-frame 序列为每帧停、seam 循环末帧跟随起始位姿。
 */
export type PoseJunctionKind = "auto" | "manual" | "edge" | "reverse" | "hold" | "per-frame" | "seam";

export type PoseJunction = { speed: number; kind: PoseJunctionKind };

/** 一个轴在一段运动区间里跟随的曲线 */
export type ResolvedAxisMotion = {
  fromRef: string;
  toRef: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  from: number;
  to: number;
  profile: MotionProfile;
  configurable: boolean;
  /** 曲线覆盖的运动区间 key；轴在中间位姿不设定时不止一个 */
  segmentKeys: readonly string[];
  /** 进入、离开这段的速度（单位/秒，绝对值）；每帧停的序列都是 0 */
  startSpeed: number;
  endSpeed: number;
};

export type ResolvedMotionSegment = {
  key: string;
  objectId: number;
  fromRef: string;
  toRef: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  fromPose: ModelPose;
  toPose: ModelPose;
  settings: MotionSegmentSettings;
  configurable: boolean;
  ownerPresetBlockId?: string;
  /** 各轴在本区间跟随的曲线；缺省时就是本区间自己的曲线 */
  axes?: Record<VirtualAxisId, ResolvedAxisMotion>;
};

export type ResolvedActionSequence = {
  id: number;
  initialPoseByObject: Map<number, ResolvedPosePoint>;
  poses: ResolvedPosePoint[];
  posesByObject: Map<number, ResolvedPosePoint[]>;
  segments: ResolvedMotionSegment[];
  commands: InstructionBlock[];
  totalMs: number;
  /**
   * 每个物体在所有位姿上都不设定的轴：这条序列不控制它们，停在哪就在哪。
   * pose 里这些轴是占位值 0，预览和接入计划用 pinUncontrolledAxes 换成实时位置。
   */
  uncontrolledAxesByObject?: Map<number, readonly VirtualAxisId[]>;
};

const clonePose = (pose: ModelPose): ModelPose => ({ v1: pose.v1, v2: pose.v2, v3: pose.v3 });

const ownAxisMotion = (segment: ResolvedMotionSegment, axis: VirtualAxisId): ResolvedAxisMotion => ({
  fromRef: segment.fromRef,
  toRef: segment.toRef,
  startMs: segment.startMs,
  endMs: segment.endMs,
  durationMs: segment.durationMs,
  from: segment.fromPose[axis],
  to: segment.toPose[axis],
  profile: segment.settings.profiles[axis],
  configurable: segment.configurable,
  segmentKeys: [segment.key],
  startSpeed: 0,
  endSpeed: 0,
});

export const segmentAxisMotion = (
  segment: ResolvedMotionSegment,
  axis: VirtualAxisId,
): ResolvedAxisMotion => segment.axes?.[axis] ?? ownAxisMotion(segment, axis);

/** 轴的曲线是否跨过了本区间的端点（轴在端点位姿上不设定） */
export const isPassThroughMotion = (
  segment: Pick<ResolvedMotionSegment, "fromRef" | "toRef">,
  motion: Pick<ResolvedAxisMotion, "fromRef" | "toRef">,
): boolean => motion.fromRef !== segment.fromRef || motion.toRef !== segment.toRef;

/** 一个物体按时间排好的区间里，某轴依次跟随的曲线（跨区间的只出现一次） */
export const objectAxisMotions = (
  segments: readonly ResolvedMotionSegment[],
  axis: VirtualAxisId,
): ResolvedAxisMotion[] => {
  const motions: ResolvedAxisMotion[] = [];
  for (const segment of segments) {
    const motion = segmentAxisMotion(segment, axis);
    const previous = motions[motions.length - 1];
    if (previous && previous.fromRef === motion.fromRef && previous.toRef === motion.toRef) continue;
    motions.push(motion);
  }
  return motions;
};

const cloneCommand = (block: InstructionBlock): InstructionBlock => ({
  id: block.id,
  kind: "instruction",
  presetId: "set-enabled",
  objectId: block.objectId,
  atMs: block.atMs,
  instr: { enabled: block.instr.enabled },
  ...(block.label !== undefined ? { label: block.label } : {}),
});

const compareSourceRef = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const cloneSettings = (settings: MotionSegmentSettings): MotionSegmentSettings => ({
  profiles: cloneAxisProfiles(settings.profiles),
});

const defaultSettings = (durationMs: number): MotionSegmentSettings => ({
  profiles: createDefaultAxisProfiles(durationMs),
});

const findSegmentConfig = (
  existing: MotionSegmentConfig[],
  fromRef: string,
  toRef: string,
): MotionSegmentConfig | undefined =>
  existing.find((item) => item.fromRef === fromRef && item.toRef === toRef);

export type ReconcileSegmentOptions = {
  minAccelTimeByObject?: (
    objectId: number,
  ) => Partial<Record<"v1" | "v2" | "v3", number>> | undefined;
};

const AXES = ["v1", "v2", "v3"] as const;

const syncProfilesToTravel = (
  settings: MotionSegmentSettings,
  travelByAxis: Partial<Record<VirtualAxisId, number>>,
  durationMs: number,
  minAccelTimeByAxis: Partial<Record<"v1" | "v2" | "v3", number>> | undefined,
): MotionSegmentSettings => {
  const profiles = { ...settings.profiles };
  for (const axis of AXES) {
    profiles[axis] = syncAxisProfileToTravel(
      profiles[axis],
      travelByAxis[axis] ?? 0,
      durationMs,
      minAccelTimeByAxis?.[axis],
    );
  }
  return { profiles };
};

const segmentTravel = (segment: ResolvedMotionSegment): Record<VirtualAxisId, number> => ({
  v1: Math.abs(segment.toPose.v1 - segment.fromPose.v1),
  v2: Math.abs(segment.toPose.v2 - segment.fromPose.v2),
  v3: Math.abs(segment.toPose.v3 - segment.fromPose.v3),
});

type SegmentConfigEntry = {
  fromRef: string;
  toRef: string;
  objectId: number;
  durationMs: number;
  /** 这条设置实际管的轴及其行程；不管的轴同步成空闲 */
  travelByAxis: Partial<Record<VirtualAxisId, number>>;
  fallback: MotionSegmentSettings;
};

/**
 * 每个可配置的运动区间一条设置；轴在中间位姿不设定时，跨过的整段曲线另有一条设置
 * （fromRef/toRef 是曲线两端的位姿）。
 */
export const reconcileSegmentConfigs = (
  resolvedSegments: ResolvedMotionSegment[],
  existing: MotionSegmentConfig[],
  options?: ReconcileSegmentOptions,
): MotionSegmentConfig[] => {
  const entries = new Map<string, SegmentConfigEntry>();
  const entryOf = (entry: SegmentConfigEntry): SegmentConfigEntry => {
    const key = `${entry.fromRef}=>${entry.toRef}`;
    const found = entries.get(key);
    if (found) return found;
    entries.set(key, entry);
    return entry;
  };
  for (const segment of resolvedSegments) {
    if (!segment.configurable) continue;
    const own = entryOf({
      fromRef: segment.fromRef,
      toRef: segment.toRef,
      objectId: segment.objectId,
      durationMs: segment.durationMs,
      travelByAxis: {},
      fallback: segment.settings,
    });
    for (const axis of AXES) {
      const motion = segmentAxisMotion(segment, axis);
      if (!motion.configurable) continue;
      const travel = Math.abs(motion.to - motion.from);
      if (!isPassThroughMotion(segment, motion)) {
        own.travelByAxis[axis] = travel;
        continue;
      }
      const span = entryOf({
        fromRef: motion.fromRef,
        toRef: motion.toRef,
        objectId: segment.objectId,
        durationMs: motion.durationMs,
        travelByAxis: {},
        fallback: defaultSettings(motion.durationMs),
      });
      span.travelByAxis[axis] = travel;
    }
  }
  return [...entries.values()].map((entry) => {
    const minAccelTimeByAxis = options?.minAccelTimeByObject?.(entry.objectId);
    const match = findSegmentConfig(existing, entry.fromRef, entry.toRef);
    const settings = match
      ? cloneSettings(match.settings)
      : options?.minAccelTimeByObject
        ? { profiles: createDefaultAxisProfiles(entry.durationMs, minAccelTimeByAxis) }
        : cloneSettings(entry.fallback);
    return {
      fromRef: entry.fromRef,
      toRef: entry.toRef,
      settings: syncProfilesToTravel(
        settings,
        entry.travelByAxis,
        entry.durationMs,
        minAccelTimeByAxis,
      ),
    };
  });
};

const dynamicPresetBlocksById = (
  blocks: ActionSequenceConfig["blocks"],
): Map<string, DynamicPresetBlock> => {
  const owners = new Map<string, DynamicPresetBlock>();
  for (const block of blocks) {
    if (block.kind === "dynamic-preset") owners.set(block.id, block);
  }
  return owners;
};

const requireDynamicOwner = (
  owners: Map<string, DynamicPresetBlock>,
  ownerId: string,
): DynamicPresetBlock => {
  const owner = owners.get(ownerId);
  if (owner === undefined) {
    throw new Error(`missing dynamic preset owner: ${ownerId}`);
  }
  return owner;
};

const ownedAxesByBlockId = (
  blocks: ActionSequenceConfig["blocks"],
): Map<string, readonly VirtualAxisId[]> => {
  const owned = new Map<string, readonly VirtualAxisId[]>();
  for (const block of blocks) {
    if (block.kind !== "static-preset" && block.kind !== "dynamic-preset") continue;
    const axes = getPresetDefinition(block.presetId)?.ownedAxes;
    if (axes === undefined) continue;
    owned.set(block.id, axes);
  }
  return owned;
};

/** 预设不管的轴沿用该轴上一个设定值（位姿里不设定的轴不算） */
const carryUnownedAxes = (
  timed: ResolvedPosePoint[],
  ownedByBlockId: ReadonlyMap<string, readonly VirtualAxisId[]>,
): void => {
  const lastByObject = new Map<number, Partial<ModelPose>>();
  let index = 0;
  while (index < timed.length) {
    const atMs = timed[index]?.atMs;
    if (atMs === undefined) break;
    let end = index + 1;
    while (end < timed.length && timed[end]?.atMs === atMs) end += 1;
    for (let cursor = index; cursor < end; cursor += 1) {
      const point = timed[cursor];
      if (point === undefined) continue;
      const owned =
        point.sourceBlockId === null ? undefined : ownedByBlockId.get(point.sourceBlockId);
      if (owned === undefined) continue;
      const previous = lastByObject.get(point.objectId);
      const next = clonePose(point.pose);
      for (const axis of AXES) {
        if (!owned.includes(axis)) {
          next[axis] = previous?.[axis] ?? 0;
        }
      }
      point.pose = next;
    }
    for (let cursor = index; cursor < end; cursor += 1) {
      const point = timed[cursor];
      if (point === undefined) continue;
      const last = { ...lastByObject.get(point.objectId) };
      for (const axis of AXES) {
        if (!point.unsetAxes?.includes(axis)) last[axis] = point.pose[axis];
      }
      lastByObject.set(point.objectId, last);
    }
    index = end;
  }
};

const WAVE_HOLD_START = "hold-start";
const WAVE_HOLD_END = "hold-end";

const injectDynamicWaveBoundaryHolds = (
  timed: ResolvedPosePoint[],
  blocks: ActionSequenceConfig["blocks"],
): void => {
  for (const block of blocks) {
    if (block.kind !== "dynamic-preset" || block.presetId !== "dynamic-wave") continue;
    for (const objectId of block.orderedObjectIds) {
      const visibles = timed.filter(
        (point) =>
          point.objectId === objectId &&
          point.sourceBlockId === block.id &&
          point.visible,
      );
      const first = visibles[0];
      const last = visibles[visibles.length - 1];
      if (!first || !last) continue;
      if (first.atMs > block.startMs) {
        const previous = [...timed]
          .filter((point) => point.objectId === objectId && point.atMs < block.startMs)
          .sort((left, right) => left.atMs - right.atMs)
          .at(-1);
        timed.push({
          sourceRef: `preset:${block.id}:${objectId}:${WAVE_HOLD_START}`,
          sourceBlockId: block.id,
          sourceKind: "dynamic-preset",
          objectId,
          atMs: block.startMs,
          pose: clonePose(previous?.pose ?? first.pose),
          editable: false,
          visible: false,
        });
      }
      if (last.atMs < block.endMs) {
        timed.push({
          sourceRef: `preset:${block.id}:${objectId}:${WAVE_HOLD_END}`,
          sourceBlockId: block.id,
          sourceKind: "dynamic-preset",
          objectId,
          atMs: block.endMs,
          pose: clonePose(last.pose),
          editable: false,
          visible: false,
        });
      }
    }
  }
};

type PassThroughSpan = {
  fromIndex: number;
  toIndex: number;
  profile: MotionProfile;
  configurable: boolean;
};

const isUnsetAt = (point: ResolvedPosePoint, axis: VirtualAxisId): boolean =>
  point.unsetAxes?.includes(axis) ?? false;

/** 轴跨过中间位姿时的曲线：同一动态预设内部跟预设，否则跟这段的区间设置，没有设置用默认 */
const passThroughProfile = (
  from: ResolvedPosePoint,
  to: ResolvedPosePoint,
  axis: VirtualAxisId,
  sequence: ActionSequenceConfig,
  owners: Map<string, DynamicPresetBlock>,
): { profile: MotionProfile; configurable: boolean } => {
  if (
    from.sourceKind === "dynamic-preset" &&
    to.sourceKind === "dynamic-preset" &&
    from.sourceBlockId !== null &&
    from.sourceBlockId === to.sourceBlockId
  ) {
    const owner = requireDynamicOwner(owners, from.sourceBlockId);
    return { profile: cloneMotionProfile(owner.profiles[axis]), configurable: false };
  }
  const match = findSegmentConfig(sequence.segments, from.sourceRef, to.sourceRef);
  return {
    profile: match
      ? cloneMotionProfile(match.settings.profiles[axis])
      : createDefaultAxisProfile(to.atMs - from.atMs),
    configurable: true,
  };
};

const progressOf = (profile: MotionProfile, tNorm: number, durationMs: number): number => {
  try {
    return evaluateMotionProfile(profile, tNorm, durationMs);
  } catch {
    // 曲线参数不合法（校验另报）时按匀速估算经过值
    return tNorm;
  }
};

/**
 * 补上不设定的轴：第一个设定值之前保持首值，最后一个之后保持末值，
 * 两个设定值之间按整段曲线算经过值。返回各轴跨过中间位姿的曲线，以及一次都没设定的轴。
 */
const fillUnsetAxes = (
  series: ResolvedPosePoint[],
  sequence: ActionSequenceConfig,
  owners: Map<string, DynamicPresetBlock>,
): { spansByAxis: Map<VirtualAxisId, PassThroughSpan[]>; uncontrolled: VirtualAxisId[] } => {
  const spansByAxis = new Map<VirtualAxisId, PassThroughSpan[]>();
  const uncontrolled: VirtualAxisId[] = [];
  for (const axis of AXES) {
    const spans: PassThroughSpan[] = [];
    spansByAxis.set(axis, spans);
    const setIndices = series.flatMap((point, index) => (isUnsetAt(point, axis) ? [] : [index]));
    const firstIndex = setIndices[0];
    const lastIndex = setIndices[setIndices.length - 1];
    // 一次都没设定的轴不受这条序列控制，留占位值 0
    if (firstIndex === undefined || lastIndex === undefined) {
      uncontrolled.push(axis);
      continue;
    }
    const firstValue = series[firstIndex]!.pose[axis];
    const lastValue = series[lastIndex]!.pose[axis];
    for (let index = 0; index < firstIndex; index += 1) series[index]!.pose[axis] = firstValue;
    for (let index = lastIndex + 1; index < series.length; index += 1) {
      series[index]!.pose[axis] = lastValue;
    }
    for (let cursor = 0; cursor < setIndices.length - 1; cursor += 1) {
      const fromIndex = setIndices[cursor]!;
      const toIndex = setIndices[cursor + 1]!;
      if (toIndex === fromIndex + 1) continue;
      const from = series[fromIndex]!;
      const to = series[toIndex]!;
      const durationMs = to.atMs - from.atMs;
      const { profile, configurable } = passThroughProfile(from, to, axis, sequence, owners);
      const start = from.pose[axis];
      const travel = to.pose[axis] - start;
      for (let index = fromIndex + 1; index < toIndex; index += 1) {
        const point = series[index]!;
        const tNorm = durationMs > 0 ? (point.atMs - from.atMs) / durationMs : 1;
        point.pose[axis] = travel === 0 ? start : start + travel * progressOf(profile, tNorm, durationMs);
      }
      spans.push({ fromIndex, toIndex, profile, configurable });
    }
  }
  return { spansByAxis, uncontrolled };
};

/** objectSegments[i] 是 series[i] → series[i + 1] */
const attachAxisMotions = (
  series: readonly ResolvedPosePoint[],
  objectSegments: readonly ResolvedMotionSegment[],
  spansByAxis: ReadonlyMap<VirtualAxisId, readonly PassThroughSpan[]>,
): void => {
  for (const segment of objectSegments) {
    segment.axes = {
      v1: ownAxisMotion(segment, "v1"),
      v2: ownAxisMotion(segment, "v2"),
      v3: ownAxisMotion(segment, "v3"),
    };
  }
  for (const axis of AXES) {
    for (const span of spansByAxis.get(axis) ?? []) {
      const from = series[span.fromIndex]!;
      const to = series[span.toIndex]!;
      const covered = objectSegments.slice(span.fromIndex, span.toIndex);
      const motion: ResolvedAxisMotion = {
        fromRef: from.sourceRef,
        toRef: to.sourceRef,
        startMs: from.atMs,
        endMs: to.atMs,
        durationMs: to.atMs - from.atMs,
        from: from.pose[axis],
        to: to.pose[axis],
        profile: span.profile,
        configurable: span.configurable,
        segmentKeys: covered.map((segment) => segment.key),
        startSpeed: 0,
        endSpeed: 0,
      };
      for (const segment of covered) segment.axes![axis] = motion;
    }
  }
};

const junctionOf = (
  incoming: ResolvedAxisMotion | undefined,
  outgoing: ResolvedAxisMotion | undefined,
  manual: number | undefined,
): PoseJunction => {
  if (!incoming || !outgoing) return { speed: 0, kind: "edge" };
  const inTravel = incoming.to - incoming.from;
  const outTravel = outgoing.to - outgoing.from;
  if (
    inTravel === 0 ||
    outTravel === 0 ||
    incoming.durationMs <= 0 ||
    outgoing.durationMs <= 0 ||
    incoming.profile.kind !== "trapezoid" ||
    outgoing.profile.kind !== "trapezoid"
  ) {
    return { speed: 0, kind: "hold" };
  }
  if (Math.sign(inTravel) !== Math.sign(outTravel)) return { speed: 0, kind: "reverse" };
  if (manual !== undefined && Number.isFinite(manual)) {
    return { speed: Math.max(0, manual), kind: "manual" };
  }
  const inSpeed = Math.abs(inTravel) / (incoming.durationMs / 1000);
  const outSpeed = Math.abs(outTravel) / (outgoing.durationMs / 1000);
  return { speed: (2 * inSpeed * outSpeed) / (inSpeed + outSpeed), kind: "auto" };
};

/**
 * 连续衔接：每个设定点按前后两段平均速度的调和平均通过（可手填，0 即停）；
 * 序列起止、折返、停留处为 0。循环序列的首尾按同一个衔接点算，由起始位姿的手填值决定。
 */
const assignJunctionSpeeds = (
  series: readonly ResolvedPosePoint[],
  objectSegments: readonly ResolvedMotionSegment[],
  sequence: ActionSequenceConfig,
): void => {
  const continuous = sequence.continuousMotion === true;
  const pointByRef = new Map(series.map((point) => [point.sourceRef, point]));
  for (const axis of AXES) {
    const setJunction = (ref: string, junction: PoseJunction) => {
      const point = pointByRef.get(ref);
      if (!point || point.unsetAxes?.includes(axis)) return;
      point.junctions = { ...point.junctions, [axis]: junction };
    };
    const motions = objectAxisMotions(objectSegments, axis);
    const first = motions[0];
    const last = motions[motions.length - 1];
    if (!first || !last) {
      if (series[0]) setJunction(series[0].sourceRef, { speed: 0, kind: continuous ? "edge" : "per-frame" });
      continue;
    }
    const refs = [first.fromRef, ...motions.map((motion) => motion.toRef)];
    const manualAt = (ref: string) => pointByRef.get(ref)?.passSpeeds?.[axis];
    const seam = continuous && sequence.loop === true;
    refs.forEach((ref, index) => {
      if (!continuous) {
        setJunction(ref, { speed: 0, kind: "per-frame" });
        return;
      }
      const isFirst = index === 0;
      const isLast = index === refs.length - 1;
      if (seam && isLast) return;
      const incoming = isFirst ? (seam ? last : undefined) : motions[index - 1];
      const outgoing = isLast ? undefined : motions[index];
      const junction = junctionOf(incoming, outgoing, manualAt(ref));
      if (incoming) incoming.endSpeed = junction.speed;
      if (outgoing) outgoing.startSpeed = junction.speed;
      setJunction(ref, junction);
      if (seam && isFirst) {
        const followsFirst = junction.kind === "auto" || junction.kind === "manual";
        setJunction(last.toRef, followsFirst ? { speed: junction.speed, kind: "seam" } : junction);
      }
    });
  }
};

/** 带进出速度的整段曲线改变了中间经过值，重算跨过的位姿和区间端点 */
const refillBoundarySpans = (
  series: readonly ResolvedPosePoint[],
  objectSegments: readonly ResolvedMotionSegment[],
): void => {
  for (const axis of AXES) {
    for (const motion of objectAxisMotions(objectSegments, axis)) {
      if (!hasMotionBoundary(motion)) continue;
      const covered = objectSegments.filter((segment) => segment.axes?.[axis] === motion);
      if (covered.length <= 1) continue;
      const valueAt = (atMs: number): number => {
        try {
          return axisMotionValueAt(motion, atMs);
        } catch {
          const tNorm = motion.durationMs > 0 ? (atMs - motion.startMs) / motion.durationMs : 1;
          return motion.from + (motion.to - motion.from) * tNorm;
        }
      };
      for (const segment of covered) {
        segment.fromPose[axis] = valueAt(segment.startMs);
        segment.toPose[axis] = valueAt(segment.endMs);
      }
      for (const point of series) {
        if (point.atMs <= motion.startMs || point.atMs >= motion.endMs) continue;
        if (point.unsetAxes?.includes(axis)) point.pose[axis] = valueAt(point.atMs);
      }
    }
  }
};

export const resolveActionSequence = (sequence: ActionSequenceConfig): ResolvedActionSequence => {
  const timed: ResolvedPosePoint[] = [];
  const commands: InstructionBlock[] = [];
  let totalMs = 0;

  for (const block of sequence.blocks) {
    if (block.kind === "pose") {
      const unsetAxes = unsetAxesOf(block.pose);
      const passSpeeds = Object.fromEntries(
        Object.entries(block.passSpeeds ?? {}).filter(
          ([axis, speed]) => isAxisSet(block.pose, axis as VirtualAxisId) && typeof speed === "number",
        ),
      ) as Partial<Record<VirtualAxisId, number>>;
      timed.push({
        sourceRef: block.id,
        sourceBlockId: block.id,
        sourceKind: "pose",
        objectId: block.objectId,
        atMs: block.atMs,
        pose: { v1: block.pose.v1 ?? 0, v2: block.pose.v2 ?? 0, v3: block.pose.v3 ?? 0 },
        editable: true,
        visible: true,
        ...(unsetAxes.length > 0 ? { unsetAxes } : {}),
        ...(Object.keys(passSpeeds).length > 0 ? { passSpeeds } : {}),
      });
      totalMs = Math.max(totalMs, block.atMs);
      continue;
    }

    if (block.kind === "instruction") {
      commands.push(cloneCommand(block));
      totalMs = Math.max(totalMs, block.atMs);
      continue;
    }

    if (block.kind === "dynamic-preset") {
      totalMs = Math.max(totalMs, block.endMs);
    } else {
      totalMs = Math.max(totalMs, block.atMs);
    }

    const points = resolvePreset(block);
    for (const point of points) {
      timed.push({
        sourceRef: point.sourceRef,
        sourceBlockId: point.sourceBlockId,
        sourceKind: block.kind,
        objectId: point.objectId,
        atMs: point.atMs,
        pose: clonePose(point.pose),
        editable: false,
        visible: true,
      });
      totalMs = Math.max(totalMs, point.atMs);
    }
  }

  timed.sort((left, right) => {
    const delta = left.atMs - right.atMs;
    if (delta !== 0) return delta;
    return compareSourceRef(left.sourceRef, right.sourceRef);
  });

  carryUnownedAxes(timed, ownedAxesByBlockId(sequence.blocks));

  injectDynamicWaveBoundaryHolds(timed, sequence.blocks);

  timed.sort((left, right) => {
    const delta = left.atMs - right.atMs;
    if (delta !== 0) return delta;
    return compareSourceRef(left.sourceRef, right.sourceRef);
  });

  commands.sort((left, right) => {
    if (left.atMs !== right.atMs) return left.atMs - right.atMs;
    return compareSourceRef(left.id, right.id);
  });

  const posesByObject = new Map<number, ResolvedPosePoint[]>();
  for (const point of timed) {
    const list = posesByObject.get(point.objectId);
    if (list) {
      list.push(point);
    } else {
      posesByObject.set(point.objectId, [point]);
    }
  }

  const initialPoseByObject = new Map<number, ResolvedPosePoint>();
  for (const [objectId, points] of posesByObject) {
    const first = points[0];
    if (first !== undefined) initialPoseByObject.set(objectId, first);
  }

  const owners = dynamicPresetBlocksById(sequence.blocks);
  const segments: ResolvedMotionSegment[] = [];
  const uncontrolledAxesByObject = new Map<number, readonly VirtualAxisId[]>();
  const objectIds = [...posesByObject.keys()].sort((a, b) => a - b);

  for (const objectId of objectIds) {
    const series = posesByObject.get(objectId);
    if (series === undefined) continue;
    const { spansByAxis, uncontrolled } = fillUnsetAxes(series, sequence, owners);
    if (uncontrolled.length > 0) uncontrolledAxesByObject.set(objectId, uncontrolled);
    const objectSegments: ResolvedMotionSegment[] = [];

    for (let index = 0; index < series.length - 1; index += 1) {
      const from = series[index];
      const to = series[index + 1];
      if (from === undefined || to === undefined) continue;

      const startMs = from.atMs;
      const endMs = to.atMs;
      const fromRef = from.sourceRef;
      const toRef = to.sourceRef;
      if (
        from.sourceKind === "dynamic-preset" &&
        to.sourceKind === "dynamic-preset" &&
        from.sourceBlockId !== null &&
        from.sourceBlockId === to.sourceBlockId
      ) {
        const block = requireDynamicOwner(owners, from.sourceBlockId);
        const durationMs = endMs - startMs;
        const fromPose = clonePose(from.pose);
        const toPose =
          from.visible === false && from.atMs === block.startMs
            ? clonePose(from.pose)
            : clonePose(to.pose);
        const draft: ResolvedMotionSegment = {
          key: `${fromRef}->${toRef}`,
          objectId,
          fromRef,
          toRef,
          startMs,
          endMs,
          durationMs,
          fromPose,
          toPose,
          settings: {
            profiles: cloneAxisProfiles(block.profiles),
          },
          configurable: false,
          ownerPresetBlockId: block.id,
        };
        draft.settings = syncProfilesToTravel(
          draft.settings,
          segmentTravel(draft),
          draft.durationMs,
          undefined,
        );
        objectSegments.push(draft);
        continue;
      }

      const match = findSegmentConfig(sequence.segments, fromRef, toRef);
      objectSegments.push({
        key: `${fromRef}->${toRef}`,
        objectId,
        fromRef,
        toRef,
        startMs,
        endMs,
        durationMs: endMs - startMs,
        fromPose: clonePose(from.pose),
        toPose: clonePose(to.pose),
        settings: match === undefined
          ? defaultSettings(endMs - startMs)
          : cloneSettings(match.settings),
        configurable: true,
      });
    }
    attachAxisMotions(series, objectSegments, spansByAxis);
    assignJunctionSpeeds(series, objectSegments, sequence);
    refillBoundarySpans(series, objectSegments);
    segments.push(...objectSegments);
  }

  return {
    id: sequence.id,
    initialPoseByObject,
    poses: timed,
    posesByObject,
    segments,
    commands,
    totalMs,
    uncontrolledAxesByObject,
  };
};

export const uncontrolledAxesOf = (
  resolved: Pick<ResolvedActionSequence, "uncontrolledAxesByObject">,
  objectId: number,
): readonly VirtualAxisId[] => resolved.uncontrolledAxesByObject?.get(objectId) ?? [];

/**
 * 把序列不控制的轴固定在给定位置（通常是实时位置）。
 * valueOf 返回 undefined 时保留占位值；没有不控制的轴时原样返回。
 */
export const pinUncontrolledAxes = (
  resolved: ResolvedActionSequence,
  valueOf: (objectId: number, axis: VirtualAxisId) => number | undefined,
): ResolvedActionSequence => {
  const entries = [...(resolved.uncontrolledAxesByObject ?? [])];
  if (entries.length === 0) return resolved;
  const pinned = new Map<number, Partial<ModelPose>>();
  for (const [objectId, axes] of entries) {
    const values: Partial<ModelPose> = {};
    for (const axis of axes) {
      const value = valueOf(objectId, axis);
      if (value !== undefined && Number.isFinite(value)) values[axis] = value;
    }
    pinned.set(objectId, values);
  }
  const pinPose = (objectId: number, pose: ModelPose): ModelPose => ({
    ...pose,
    ...pinned.get(objectId),
  });

  const pointByRef = new Map<ResolvedPosePoint, ResolvedPosePoint>();
  const poses = resolved.poses.map((point) => {
    const next = { ...point, pose: pinPose(point.objectId, point.pose) };
    pointByRef.set(point, next);
    return next;
  });
  const posesByObject = new Map(
    [...resolved.posesByObject].map(([objectId, series]) => [
      objectId,
      series.map((point) => pointByRef.get(point) ?? point),
    ]),
  );
  const initialPoseByObject = new Map(
    [...resolved.initialPoseByObject].map(([objectId, point]) => [
      objectId,
      pointByRef.get(point) ?? point,
    ]),
  );
  const segments = resolved.segments.map((segment) => {
    const values = pinned.get(segment.objectId);
    if (!values || Object.keys(values).length === 0) return segment;
    const axes = segment.axes ? { ...segment.axes } : undefined;
    for (const axis of AXES) {
      const value = values[axis];
      if (value === undefined || !axes) continue;
      axes[axis] = { ...axes[axis], from: value, to: value };
    }
    return {
      ...segment,
      fromPose: pinPose(segment.objectId, segment.fromPose),
      toPose: pinPose(segment.objectId, segment.toPose),
      ...(axes ? { axes } : {}),
    };
  });
  return { ...resolved, poses, posesByObject, initialPoseByObject, segments };
};
