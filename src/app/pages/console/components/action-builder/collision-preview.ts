import type { ActionSequenceConfig, ModelPose } from "@/app/project/action-sequence/types";
import type { CollisionEvent, CollisionSaveBatch } from "@/app/project/collision/types";
import type { ProjectSetup, VirtualAxisId } from "@/app/project/project-document-types";
import type { MonitorPositions } from "../monitor-grid/monitor-data";

export type CollisionBasePoses = ReadonlyMap<number, Partial<ModelPose>>;
export type CollisionSource = {
  projectKey: string;
  setup: ProjectSetup;
  dragging: boolean;
  savedBatch: CollisionSaveBatch | null;
  readBasePoses: () => Map<number, Partial<ModelPose>>;
};

type Span = { startMs: number; endMs: number };
type CollisionTimes = Map<number, Span[]>;

export type CollisionPreview = {
  sequence: ActionSequenceConfig;
  setup: ProjectSetup;
  basePoses: CollisionBasePoses;
  times: CollisionTimes;
};

export const indexCollisionTimes = (events: readonly CollisionEvent[]): CollisionTimes => {
  const times: CollisionTimes = new Map();
  for (const event of events) {
    if (event.kind !== "collision") continue;
    for (const id of event.objectIds) {
      const spans = times.get(id);
      if (spans) spans.push(event);
      else times.set(id, [event]);
    }
  }
  for (const [id, spans] of times) {
    spans.sort((a, b) => a.startMs - b.startMs);
    const merged: Span[] = [];
    for (const span of spans) {
      const previous = merged.at(-1);
      if (previous && previous.endMs >= span.startMs) previous.endMs = Math.max(previous.endMs, span.endMs);
      else merged.push({ startMs: span.startMs, endMs: span.endMs });
    }
    times.set(id, merged);
  }
  return times;
};

export const collisionIdsAt = (times: CollisionTimes, cursorMs: number): number[] => {
  const ids: number[] = [];
  for (const [id, spans] of times) {
    let left = 0;
    let right = spans.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (spans[mid]!.endMs < cursorMs) left = mid + 1;
      else right = mid;
    }
    if (left < spans.length && spans[left]!.startMs <= cursorMs) ids.push(id);
  }
  return ids;
};

export const captureCollisionBasePoses = (
  snapshots: readonly { descriptor: { id: number }; live: boolean; positions: MonitorPositions | null }[],
): Map<number, Partial<ModelPose>> => {
  const poses = new Map<number, Partial<ModelPose>>();
  for (const { descriptor, live, positions } of snapshots) {
    if (!live || !positions) continue;
    const pose: Partial<ModelPose> = {};
    if (Number.isFinite(positions.h)) pose.v1 = positions.h;
    if (Number.isFinite(positions.p)) pose.v2 = positions.p;
    if (Number.isFinite(positions.y)) pose.v3 = positions.y;
    if (Object.keys(pose).length) poses.set(descriptor.id, pose);
  }
  return poses;
};

export const collisionPreviewPoses = (
  animated: ReadonlyMap<number, ModelPose>,
  uncontrolled: ReadonlyMap<number, readonly VirtualAxisId[]> | null,
  base: CollisionBasePoses,
): Map<number, ModelPose> => {
  const result = new Map(animated);
  for (const [id, values] of base) {
    const pose = animated.get(id);
    if (!pose) {
      result.set(id, { v1: 0, v2: 0, v3: 0, ...values });
      continue;
    }
    const pinned = { ...pose };
    for (const axis of uncontrolled?.get(id) ?? []) {
      if (values[axis] !== undefined) pinned[axis] = values[axis];
    }
    result.set(id, pinned);
  }
  return result;
};
