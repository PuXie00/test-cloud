import type { ModelPose } from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import type { MonitorPositions } from "../components/monitor-grid/monitor-data";

export type LivePoseSource = {
  id: number;
  positions: MonitorPositions | null;
};

const hasTelemetry = (positions: MonitorPositions | null): positions is MonitorPositions =>
  positions !== null &&
  (positions.h !== undefined || positions.p !== undefined || positions.y !== undefined);

const INSTALL_POSE: ModelPose = { v1: 0, v2: 0, v3: 0 };

const poseFromTelemetry = (positions: MonitorPositions): ModelPose => ({
  v1: positions.h ?? 0,
  v2: positions.p ?? 0,
  v3: positions.y ?? 0,
});

export const resolveLivePoses = (
  sources: readonly LivePoseSource[],
  virtualAxisObjectIds: ReadonlySet<number>,
): Map<number, ModelPose> => {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const poses = new Map<number, ModelPose>();
  for (const id of virtualAxisObjectIds) {
    const source = byId.get(id);
    poses.set(
      id,
      source && hasTelemetry(source.positions)
        ? poseFromTelemetry(source.positions)
        : INSTALL_POSE,
    );
  }
  return poses;
};

/** 序列不控制的轴显示实时位置 */
export const pinLiveAxes = (
  preview: Map<number, ModelPose>,
  uncontrolledByObject: ReadonlyMap<number, readonly VirtualAxisId[]> | null,
  live: ReadonlyMap<number, ModelPose>,
): Map<number, ModelPose> => {
  if (!uncontrolledByObject || uncontrolledByObject.size === 0) return preview;
  const next = new Map(preview);
  for (const [objectId, axes] of uncontrolledByObject) {
    const pose = next.get(objectId);
    const livePose = live.get(objectId);
    if (!pose || !livePose) continue;
    const pinned = { ...pose };
    for (const axis of axes) pinned[axis] = livePose[axis];
    next.set(objectId, pinned);
  }
  return next;
};

export const mergeHoldPoses = (
  preview: Map<number, ModelPose>,
  live: Map<number, ModelPose>,
  holding: boolean,
): Map<number, ModelPose> => (holding ? live : preview);
