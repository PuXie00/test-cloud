import type { ActionSequenceConfig, KeyframePose, PoseBlock } from "@/app/project/action-sequence/types";
import type { VirtualAxisValues } from "@/app/project/project-document-types";
import {
  clampToAxisRange,
  positionsToAxisValues,
  type GoBinding,
  type GoTargetSource,
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
 * 物体的 GO 目标：给了值的轴取这个值，其余轴（经过、序列不控制）保持当前位置；
 * 都按物体行程截断。没有监控数据的物体跳过。
 */
const buildGoBindings = (
  poses: ReadonlyMap<number, KeyframePose>,
  participants: readonly DimensionParticipant[],
  source: GoTargetSource,
): Map<string, GoBinding> => {
  const byId = new Map(participants.map((item) => [item.objectId, item]));
  const bindings = new Map<string, GoBinding>();
  for (const [objectId, pose] of poses) {
    const participant = byId.get(String(objectId));
    if (!participant) continue;
    const current = positionsToAxisValues(participant.snapshot.positions);
    const target: VirtualAxisValues = {};
    for (const axis of participant.axes) {
      const value = pose[axis] ?? current[axis];
      if (value !== undefined) target[axis] = clampToAxisRange(value, participant.ranges[axis]);
    }
    if (Object.keys(target).length === 0) continue;
    bindings.set(participant.objectId, { target, current, source });
  }
  return bindings;
};

/** 选中位姿的 GO 目标（影子停在位姿上）：位姿里设定了值的轴取位姿值 */
export const buildPoseGoBindings = (
  poses: readonly PoseBlock[],
  participants: readonly DimensionParticipant[],
): Map<string, GoBinding> =>
  buildGoBindings(
    new Map(poses.map((block) => [block.objectId, block.pose])),
    participants,
    { kind: "pose", atMs: sharedTimeMs(poses) },
  );

/** 没选位姿时影子跟着游标：游标处序列的样子（只含序列控制的轴） */
export const buildCursorGoBindings = (
  poses: ReadonlyMap<number, KeyframePose>,
  participants: readonly DimensionParticipant[],
  cursorMs: number,
): Map<string, GoBinding> => buildGoBindings(poses, participants, { kind: "cursor", atMs: cursorMs });

/** 影子跟着游标时看哪些物体：选中的物体里在序列中的；一个都不在（或没选）就是序列里全部物体 */
export const cursorShadowObjectIds = (
  sequenceObjectIds: readonly number[],
  selectedObjectIds: readonly number[],
): number[] => {
  const picked = sequenceObjectIds.filter((objectId) => selectedObjectIds.includes(objectId));
  return picked.length > 0 ? picked : [...sequenceObjectIds];
};

/** 位姿的值变了才需要重新设 GO 目标 */
export const livePoseBindingKey = (poses: readonly PoseBlock[]): string =>
  poses
    .map((block) => `${block.id}:${block.objectId}:${block.pose.v1 ?? ""},${block.pose.v2 ?? ""},${block.pose.v3 ?? ""}`)
    .join("|");

function sharedTimeMs(poses: readonly PoseBlock[]): number | undefined {
  const first = poses[0]?.atMs;
  return first !== undefined && poses.every((block) => block.atMs === first) ? first : undefined;
}

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

/** 手动控制顶部：影子跟着游标时的说明 */
export const cursorShadowLabel = (cursorMs: number, count: number): string =>
  `影子跟着游标：${formatTime(cursorMs)} s · ${count} 台`;

/** 联机说明下面的一句提示：维度控制改的是什么、怎么写回 */
export const LIVE_POSE_HINT = "维度控制直接改位姿（可撤销）；点动到位后按「取当前」写回";
export const CURSOR_SHADOW_HINT = "拖游标影子跟着走，按 GO 走到这一帧；设备不会自己动";
