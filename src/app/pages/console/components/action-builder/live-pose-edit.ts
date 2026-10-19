import type { ActionSequenceConfig, PoseBlock } from "@/app/project/action-sequence/types";
import type { VirtualAxisValues } from "@/app/project/project-document-types";
import {
  clampToAxisRange,
  positionsToAxisValues,
  type GoBinding,
} from "../../hooks/go-ready";
import type { DimensionParticipant } from "../right-tab-panel/manual-control-tab/dimension-edit";
import { selectionBlockIds, type SequenceSelection } from "./sequence-selection";
import { formatTime } from "./timeline/timeline-data";

/**
 * 动作页联机编辑（「当前位置」打开）选中的位姿：
 * none 没选位姿；conflict 同一物体选了多个时刻的位姿；poses 每个物体一个位姿。
 */
export type LivePoseSelection =
  | { kind: "none" }
  | { kind: "conflict" }
  | { kind: "poses"; poses: PoseBlock[] };

export const LIVE_POSE_CONFLICT_NOTICE = "同一物体选了多个时刻的位姿，联机时每个物体只能选一个";
export const LIVE_POSE_MOVING_NOTICE = "设备运动中，停稳后再取当前";

export const resolveLivePoseSelection = (
  sequence: ActionSequenceConfig | null,
  selection: SequenceSelection,
): LivePoseSelection => {
  if (!sequence) return { kind: "none" };
  const ids = new Set(selectionBlockIds(selection));
  const poses = sequence.blocks.filter(
    (block): block is PoseBlock => block.kind === "pose" && ids.has(block.id),
  );
  if (poses.length === 0) return { kind: "none" };
  const objectIds = new Set(poses.map((block) => block.objectId));
  if (objectIds.size !== poses.length) return { kind: "conflict" };
  return { kind: "poses", poses };
};

/**
 * 选中位姿的 GO 目标：位姿里设定了值的轴取位姿值，其余轴（经过、序列不控制）保持当前位置；
 * 都按物体行程截断。没有监控数据的物体跳过。
 */
export const buildPoseGoBindings = (
  poses: readonly PoseBlock[],
  participants: readonly DimensionParticipant[],
): Map<string, GoBinding> => {
  const byId = new Map(participants.map((item) => [item.objectId, item]));
  const bindings = new Map<string, GoBinding>();
  for (const block of poses) {
    const participant = byId.get(String(block.objectId));
    if (!participant) continue;
    const current = positionsToAxisValues(participant.snapshot.positions);
    const target: VirtualAxisValues = {};
    for (const axis of participant.axes) {
      const value = block.pose[axis] ?? current[axis];
      if (value !== undefined) target[axis] = clampToAxisRange(value, participant.ranges[axis]);
    }
    if (Object.keys(target).length === 0) continue;
    bindings.set(participant.objectId, { target, current });
  }
  return bindings;
};

/** 位姿的值变了才需要重新设 GO 目标 */
export const livePoseBindingKey = (poses: readonly PoseBlock[]): string =>
  poses
    .map((block) => `${block.id}:${block.objectId}:${block.pose.v1 ?? ""},${block.pose.v2 ?? ""},${block.pose.v3 ?? ""}`)
    .join("|");

const sharedTimeMs = (poses: readonly PoseBlock[]): number | undefined => {
  const first = poses[0]?.atMs;
  return first !== undefined && poses.every((block) => block.atMs === first) ? first : undefined;
};

/** 手动控制顶部的联机说明 */
export const livePoseLabel = (poses: readonly PoseBlock[]): string => {
  const atMs = sharedTimeMs(poses);
  if (atMs === undefined) return `联机编辑 ${poses.length} 个位姿`;
  return poses.length === 1
    ? `联机编辑 ${formatTime(atMs)} s 的位姿`
    : `联机编辑 ${formatTime(atMs)} s 的 ${poses.length} 个位姿`;
};

/** 「取当前」按钮写明写到哪里 */
export const captureLabel = (
  live: LivePoseSelection,
  sequence: ActionSequenceConfig | null,
  cursorMs: number,
): string => {
  if (live.kind === "poses") {
    return live.poses.length === 1 ? "取当前 → 更新位姿" : `取当前 → 更新 ${live.poses.length} 个位姿`;
  }
  return sequence ? `取当前 → 写入 ${formatTime(cursorMs)} s` : "取当前 → 新建动作序列";
};
