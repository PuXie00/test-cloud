import type { ModelPose } from "@/app/project/action-sequence/types";
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

export const mergeHoldPoses = (
  preview: Map<number, ModelPose>,
  live: Map<number, ModelPose>,
  holding: boolean,
): Map<number, ModelPose> => (holding ? live : preview);
