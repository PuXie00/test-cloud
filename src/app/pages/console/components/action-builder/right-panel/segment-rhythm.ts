import {
  resolveActionSequence,
  type ResolvedMotionSegment,
} from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { profileForDuration } from "../motion-profile/segment-presets";
import {
  moveTimelineBlock,
  writeSegmentProfiles,
  type SegmentProfileWrite,
  type SequenceEditOptions,
} from "../sequence-ops";
import { TIME_STEP_MS, snapTimeMs, type ControlledObject } from "../timeline/timeline-data";
import { segmentRampAxes } from "./segment-retime";

export type RhythmEdit = { ok: true; sequence: ActionSequenceConfig } | { ok: false; message: string };

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

