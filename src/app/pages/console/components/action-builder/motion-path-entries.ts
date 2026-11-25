import { segmentPoseAt } from "@/app/project/action-sequence/evaluate-sequence";
import type {
  ResolvedActionSequence,
  ResolvedMotionSegment,
  ResolvedPosePoint,
} from "@/app/project/action-sequence/resolve-sequence";
import type { ModelPose } from "@/app/project/action-sequence/types";
import type { InvalidTimelineTargets } from "@/app/project/action-sequence/validate-sequence";
import type {
  MotionPathEntry,
  MotionPathIssueSpan,
  MotionPathKeyframe,
  MotionPathMode,
  MotionPathSample,
} from "@/app/viz3d/pose-handles/motion-path-types";

/** 一条轨迹最多取这么多个样（另加区间起止）：长序列按比例放宽，不低于 100 ms */
const MAX_PATH_SAMPLES = 240;

export const motionPathSampleStepMs = (totalMs: number): number =>
  Math.max(100, Math.ceil(totalMs / MAX_PATH_SAMPLES / 100) * 100);

const lerpPose = (from: ModelPose, to: ModelPose, t: number): ModelPose => ({
  v1: from.v1 + (to.v1 - from.v1) * t,
  v2: from.v2 + (to.v2 - from.v2) * t,
  v3: from.v3 + (to.v3 - from.v3) * t,
});

/**
 * 物体某一刻的样子（同序列预览的算法）。这一段的曲线算不出来（如时长不够加减速）时
 * 按起止直线插值：有问题的段也画得出来（标红），不会让整条轨迹、整个页面出错。
 */
export const objectPoseAtSafe = (
  points: readonly Pick<ResolvedPosePoint, "atMs" | "pose">[],
  segments: readonly ResolvedMotionSegment[],
  atMs: number,
): ModelPose | undefined => {
  const first = points[0];
  if (first === undefined) return undefined;
  if (atMs <= first.atMs) return { ...first.pose };
  for (const segment of segments) {
    if (atMs < segment.startMs) return { ...segment.fromPose };
    if (atMs < segment.endMs) {
      try {
        return segmentPoseAt(segment, atMs);
      } catch {
        const t = segment.durationMs > 0 ? (atMs - segment.startMs) / segment.durationMs : 1;
        return lerpPose(segment.fromPose, segment.toPose, Math.min(1, Math.max(0, t)));
      }
    }
  }
  return { ...points[points.length - 1]!.pose };
};

const segmentsByObject = (
  resolved: Pick<ResolvedActionSequence, "segments">,
): Map<number, ResolvedMotionSegment[]> => {
  const result = new Map<number, ResolvedMotionSegment[]>();
  for (const segment of resolved.segments) {
    const list = result.get(segment.objectId);
    if (list) list.push(segment);
    else result.set(segment.objectId, [segment]);
  }
  for (const list of result.values()) list.sort((left, right) => left.startMs - right.startMs);
  return result;
};

/** 这些物体按时间取样（含区间起止），算不出来的段按直线插值 */
export const sampleMotionPaths = (
  resolved: Pick<ResolvedActionSequence, "posesByObject" | "segments" | "totalMs">,
  objectIds: readonly number[],
  stepMs: number,
): Map<number, Array<{ atMs: number; pose: ModelPose }>> => {
  const segments = segmentsByObject(resolved);
  const result = new Map<number, Array<{ atMs: number; pose: ModelPose }>>();
  for (const objectId of objectIds) {
    const points = resolved.posesByObject.get(objectId) ?? [];
    const own = segments.get(objectId) ?? [];
    const times = new Set<number>([0, resolved.totalMs]);
    for (let atMs = 0; atMs < resolved.totalMs; atMs += stepMs) times.add(atMs);
    for (const segment of own) {
      times.add(segment.startMs);
      times.add(segment.endMs);
    }
    const samples: Array<{ atMs: number; pose: ModelPose }> = [];
    for (const atMs of [...times].sort((left, right) => left - right)) {
      const pose = objectPoseAtSafe(points, own, atMs);
      if (pose) samples.push({ atMs, pose });
    }
    result.set(objectId, samples);
  }
  return result;
};

/** 游标处各物体的样子（算不出来的段按直线插值） */
export const posesAtSafe = (
  resolved: Pick<ResolvedActionSequence, "posesByObject" | "segments">,
  atMs: number,
): Map<number, ModelPose> => {
  const segments = segmentsByObject(resolved);
  const result = new Map<number, ModelPose>();
  for (const [objectId, points] of resolved.posesByObject) {
    const pose = objectPoseAtSafe(points, segments.get(objectId) ?? [], atMs);
    if (pose) result.set(objectId, pose);
  }
  return result;
};

/** 画哪些物体的轨迹：选中的物体和选中块的物体（「全部」时序列里全部），只要序列里有的 */
export const motionPathObjectIds = (input: {
  mode: MotionPathMode;
  sequenceObjectIds: readonly number[];
  selectedObjectIds: readonly number[];
  selectedBlockObjectIds: readonly number[];
}): number[] => {
  if (input.mode === "off") return [];
  if (input.mode === "all") return [...input.sequenceObjectIds];
  const inSequence = new Set(input.sequenceObjectIds);
  return [...new Set([...input.selectedObjectIds, ...input.selectedBlockObjectIds])].filter((id) => inSequence.has(id));
};

export type MotionPathBuildInput = {
  resolved: Pick<ResolvedActionSequence, "posesByObject" | "segments">;
  /** 每台物体按时间取的样（序列的值） */
  samples: ReadonlyMap<number, ReadonlyArray<{ atMs: number; pose: ModelPose }>>;
  /** 游标处序列的样子 */
  cursorPoses: ReadonlyMap<number, ModelPose>;
  cursorMs: number;
  /** 要画轨迹的物体 */
  objectIds: readonly number[];
  /** 选中的物体：画得显眼，轨迹线能点 */
  selectedObjectIds: ReadonlySet<number>;
  selectedBlockIds: ReadonlySet<string>;
  invalid: Pick<InvalidTimelineTargets, "blockIds" | "segmentKeys">;
  /** 序列不控制的轴：按 3D 正在显示的值画（和物体对得上） */
  pinnedAxes: (objectId: number) => Partial<ModelPose>;
  engineIdOf: (objectId: number) => string;
};

const issueSpansOf = (input: MotionPathBuildInput, objectId: number): MotionPathIssueSpan[] =>
  input.resolved.segments
    .filter((segment) => segment.objectId === objectId && input.invalid.segmentKeys.has(segment.key))
    .map((segment) => ({ fromMs: segment.startMs, toMs: segment.endMs, segmentKey: segment.key }));

/**
 * 3D 轨迹要画的东西：轨迹、位姿点（选中的高亮、有错的标红）、游标亮点、有问题的段；
 * 游标正在有问题的段里时物体标红（没画轨迹的物体也标，只画红框）。
 */
export const buildMotionPathEntries = (input: MotionPathBuildInput): MotionPathEntry[] => {
  const shown = new Set(input.objectIds);
  const entries: MotionPathEntry[] = [];
  const pin = (objectId: number, pose: ModelPose) => ({ ...pose, ...input.pinnedAxes(objectId) });

  for (const [objectId, points] of input.resolved.posesByObject) {
    const issues = issueSpansOf(input, objectId);
    const issueAtCursor = issues.some((span) => span.fromMs <= input.cursorMs && input.cursorMs <= span.toMs);
    const cursorPose = input.cursorPoses.get(objectId);
    const cursor: MotionPathSample | null = cursorPose ? { atMs: input.cursorMs, values: pin(objectId, cursorPose) } : null;
    if (!shown.has(objectId)) {
      if (issueAtCursor && cursor) {
        entries.push({
          objectId: input.engineIdOf(objectId),
          selected: false,
          samples: [],
          keyframes: [],
          cursor,
          issues: [],
          issueAtCursor: true,
        });
      }
      continue;
    }
    const keyframes: MotionPathKeyframe[] = points
      .filter((point) => point.visible)
      .map((point) => ({
        atMs: point.atMs,
        values: pin(objectId, point.pose),
        blockId: point.sourceBlockId,
        selected: point.sourceBlockId !== null && input.selectedBlockIds.has(point.sourceBlockId),
        invalid: point.sourceBlockId !== null && input.invalid.blockIds.has(point.sourceBlockId),
      }));
    entries.push({
      objectId: input.engineIdOf(objectId),
      selected: input.selectedObjectIds.has(objectId),
      samples: (input.samples.get(objectId) ?? []).map((sample) => ({
        atMs: sample.atMs,
        values: pin(objectId, sample.pose),
      })),
      keyframes,
      cursor,
      issues,
      issueAtCursor,
    });
  }
  return entries;
};
