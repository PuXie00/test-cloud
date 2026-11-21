import {
  resolveActionSequence,
  type ResolvedMotionSegment,
} from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { profileForDuration } from "../motion-profile/segment-presets";
import {
  applyPlannedPoses,
  moveTimelineBlock,
  writeSegmentProfiles,
  type PlannedPosesWrite,
  type SegmentProfileWrite,
  type SequenceEditOptions,
} from "../sequence-ops";
import { TIME_STEP_MS, snapTimeMs, type ControlledObject } from "../timeline/timeline-data";
import { planChase, type ChaseObject, type ChaseObjectPlan } from "./chase-plan";
import { objectRateLimits, segmentRampAxes } from "./segment-retime";

export type RhythmEdit = { ok: true; sequence: ActionSequenceConfig } | { ok: false; message: string };

const AXES: readonly VirtualAxisId[] = ["v1", "v2", "v3"];

const selectedSegments = (sequence: ActionSequenceConfig, keys: readonly string[]) => {
  const wanted = new Set(keys);
  return resolveActionSequence(sequence).segments.filter((segment) => wanted.has(segment.key));
};

const onePerObject = (segments: readonly ResolvedMotionSegment[]): boolean =>
  new Set(segments.map((segment) => segment.objectId)).size === segments.length;

/**
 * 错峰：选中的区间（每台一段）到达不动，按起点先后依次晚 gapMs 出发（最早那段不动），时长变短；
 * 起步收尾在档上的按档位重算，不在档上的保留变速时间。
 */
export const staggerSegments = (
  sequence: ActionSequenceConfig,
  keys: readonly string[],
  gapMs: number,
  objectOf: (objectId: number) => ControlledObject | undefined,
  options?: SequenceEditOptions,
): RhythmEdit => {
  const segments = selectedSegments(sequence, keys).sort(
    (a, b) => a.startMs - b.startMs || a.objectId - b.objectId,
  );
  if (segments.length < 2 || !onePerObject(segments)) {
    return { ok: false, message: "错峰要选两台以上，每台一段" };
  }
  const base = segments[0]!.startMs;
  let next = sequence;
  const writes: SegmentProfileWrite[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const name = objectOf(segment.objectId)?.name ?? `物体 ${segment.objectId}`;
    const startMs = snapTimeMs(base + index * gapMs);
    if (startMs >= segment.endMs - TIME_STEP_MS) return { ok: false, message: `间隔太大：${name} 那段排不下` };
    if (startMs === segment.startMs) continue;
    const block = next.blocks.find((item) => item.id === segment.fromRef);
    if (block?.kind !== "pose") return { ok: false, message: `${name} 的起点是预设的关键点，挪不了` };
    const moved = moveTimelineBlock(next, block.id, startMs, options);
    const after = moved.blocks.find((item) => item.id === block.id);
    if (after?.kind !== "pose" || after.atMs !== startMs) {
      return { ok: false, message: `${name} 的起点挪不过去（会碰到别的块）` };
    }
    next = moved;
    const durationMs = segment.endMs - startMs;
    for (const axis of segmentRampAxes(segment, objectOf(segment.objectId))) {
      writes.push({
        fromRef: segment.fromRef,
        toRef: segment.toRef,
        axis: axis.axis,
        profile: profileForDuration(axis, durationMs),
        durationMs,
      });
    }
  }
  if (next === sequence) return { ok: false, message: "已经是这个间隔了" };
  return { ok: true, sequence: writeSegmentProfiles(next, writes) };
};

/** 已有区间上重排：不要「先停着」的位姿 */
const withoutHoldPoses = (object: ChaseObjectPlan) => {
  const hold = object.poses.filter((pose) => pose.atMs < object.moveStartMs).length;
  return {
    objectId: object.objectId,
    poses: object.poses.slice(hold),
    segments: object.segments.map((segment) => ({
      ...segment,
      fromIndex: segment.fromIndex - hold,
      toIndex: segment.toIndex - hold,
    })),
  };
};

/**
 * 汇合：两台各一段、同一时刻到同一位置 → 按追赶汇合重排。起点沿运动方向更靠前的是领先的 B，
 * 另一台是追赶的 A；加上汇合位姿、填经过速度，不挪别的块。
 */
export const mergeSegments = (
  sequence: ActionSequenceConfig,
  keys: readonly string[],
  objectOf: (objectId: number) => ControlledObject | undefined,
  options?: SequenceEditOptions,
): RhythmEdit => {
  const segments = selectedSegments(sequence, keys);
  if (segments.length !== 2 || !onePerObject(segments)) return { ok: false, message: "汇合要选两台，各一段" };
  const [first, second] = segments as [ResolvedMotionSegment, ResolvedMotionSegment];
  if (first.endMs !== second.endMs) return { ok: false, message: "两段要同时到达：先用「同时到达」对齐" };
  const axis = AXES.find(
    (item) =>
      Math.abs(first.toPose[item] - second.toPose[item]) < 1e-6 &&
      first.fromPose[item] !== first.toPose[item] &&
      second.fromPose[item] !== second.toPose[item],
  );
  if (!axis) return { ok: false, message: "两段要走到同一个位置" };
  const dir = Math.sign(first.toPose[axis] - first.fromPose[axis]);
  const along = (segment: ResolvedMotionSegment) => (segment.fromPose[axis] - first.fromPose[axis]) * dir;
  const [leader, chaser] = along(second) > along(first) ? [second, first] : [first, second];
  const startMs = Math.min(first.startMs, second.startMs);
  const toObject = (segment: ResolvedMotionSegment): ChaseObject => ({
    objectId: segment.objectId,
    name: objectOf(segment.objectId)?.name ?? `物体 ${segment.objectId}`,
    from: { [axis]: segment.fromPose[axis] },
    to: { [axis]: segment.toPose[axis] },
    limits: objectRateLimits(objectOf(segment.objectId)),
  });
  const plan = planChase(startMs, [toObject(chaser), toObject(leader)], {
    axis,
    chaserId: chaser.objectId,
    leaderId: leader.objectId,
    chaserStartMs: chaser.startMs - startMs,
    leaderStartMs: leader.startMs - startMs,
    arriveAtMs: first.endMs - startMs,
  });
  if (plan.error) return { ok: false, message: plan.error };
  const write: PlannedPosesWrite = { objects: plan.objects.map(withoutHoldPoses) };
  const result = applyPlannedPoses(sequence, write, options);
  return result.ok ? { ok: true, sequence: result.sequence } : { ok: false, message: "汇合写不进去，和已有的块冲突了" };
};
