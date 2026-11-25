import type { ControlType } from "@/app/project/configuration-types";
import type { ActionSequenceConfig, KeyframePose, ModelPose, PoseBlock } from "@/app/project/action-sequence/types";
import type { VirtualAxisId, VirtualAxisValues } from "@/app/project/project-document-types";
import { poseHandleKindsFor, type PoseHandleKind } from "@/app/viz3d/pose-handles/pose-handle-types";
import { selectionBlockIds, type SequenceSelection } from "./sequence-selection";
import { snapTimeMs } from "./timeline/timeline-data";

export const POSE_HANDLE_PRESET_HINT = "游标在预设里，这一刻的位置由预设决定：先拆开预设再拖";
export const POSE_HANDLE_REF_HINT = "游标在引用的序列里：先展开引用再拖";
export const POSE_HANDLE_CONFLICT_HINT = "同一物体选了几个时刻的位姿：只选一个再拖";
export const POSE_HANDLE_OFF_CURSOR_HINT = "选中的位姿不在游标处：把游标移到位姿上再拖";

/** 3D 手柄改的是哪个位姿 */
export type PoseHandleEditTarget = {
  objectId: number;
  /** 改这个位姿块；null 表示拖动时在 atMs 给它加一个位姿（像自动关键帧） */
  blockId: string | null;
  atMs: number;
  kinds: PoseHandleKind[];
  /** 拖不了的原因（手柄画成虚的） */
  blockedReason: string | null;
};

export type PoseHandleObjectInfo = {
  controlType?: ControlType;
  enabledAxes?: readonly VirtualAxisId[];
};

/** 这台物体在这一时刻的位姿块 */
export const poseBlockAt = (
  sequence: Pick<ActionSequenceConfig, "blocks">,
  objectId: number,
  atMs: number,
): PoseBlock | undefined =>
  sequence.blocks.find(
    (block): block is PoseBlock => block.kind === "pose" && block.objectId === objectId && block.atMs === atMs,
  );

/** 游标处这些物体的位姿块（3D 里点物体时选中它们） */
export const poseBlocksAtCursor = (
  sequence: Pick<ActionSequenceConfig, "blocks">,
  objectIds: readonly number[],
  cursorMs: number,
): PoseBlock[] => {
  const at = snapTimeMs(cursorMs);
  const ids = new Set(objectIds);
  return sequence.blocks.filter(
    (block): block is PoseBlock => block.kind === "pose" && ids.has(block.objectId) && block.atMs === at,
  );
};

/** 物体离游标最近的位姿（一样近取前面那个）；没有位姿时 undefined */
export const nearestPoseBlock = (
  sequence: Pick<ActionSequenceConfig, "blocks">,
  objectId: number,
  cursorMs: number,
): PoseBlock | undefined => {
  let best: PoseBlock | undefined;
  for (const block of sequence.blocks) {
    if (block.kind !== "pose" || block.objectId !== objectId) continue;
    const distance = Math.abs(block.atMs - cursorMs);
    const bestDistance = best ? Math.abs(best.atMs - cursorMs) : Number.POSITIVE_INFINITY;
    if (distance < bestDistance || (distance === bestDistance && best && block.atMs < best.atMs)) best = block;
  }
  return best;
};

/**
 * 这一刻这台物体的位置由预设或引用的序列决定（3D 里拖不了，要先拆开 / 展开）；
 * 范围两端也算（那一刻是它们的关键点）。
 */
export const poseHandleBlockReason = (
  sequence: Pick<ActionSequenceConfig, "blocks">,
  objectId: number,
  atMs: number,
): string | null => {
  for (const block of sequence.blocks) {
    if (block.kind === "pose" || block.kind === "instruction") continue;
    if (!block.orderedObjectIds.includes(objectId)) continue;
    if (block.kind === "static-preset" && block.atMs === atMs) return POSE_HANDLE_PRESET_HINT;
    if (block.kind === "dynamic-preset" && block.startMs <= atMs && atMs <= block.endMs) return POSE_HANDLE_PRESET_HINT;
    if (block.kind === "sequence-ref" && block.atMs <= atMs && atMs <= block.atMs + block.durationMs) {
      return POSE_HANDLE_REF_HINT;
    }
  }
  return null;
};

export type PoseHandleTargetInput = {
  sequence: Pick<ActionSequenceConfig, "blocks">;
  selection: SequenceSelection;
  selectedObjectIds: readonly number[];
  cursorMs: number;
  /** 「当前位置」开着：手柄挂在 GO 影子（选中的位姿）上，位姿不必在游标处 */
  liveMode: boolean;
  objectInfo: (objectId: number) => PoseHandleObjectInfo | undefined;
};

/**
 * 3D 里哪些物体出手柄、各改哪个位姿：选中的物体和选中位姿的物体；
 * 选了这台的位姿就改那个位姿，没选就改游标处的位姿（没有就拖的时候加）。
 */
export const resolvePoseHandleEditTargets = (input: PoseHandleTargetInput): PoseHandleEditTarget[] => {
  const { sequence, selection, selectedObjectIds, cursorMs, liveMode, objectInfo } = input;
  const at = snapTimeMs(cursorMs);
  const selectedIds = new Set(selectionBlockIds(selection));
  const selectedPoses = new Map<number, PoseBlock[]>();
  for (const block of sequence.blocks) {
    if (block.kind !== "pose" || !selectedIds.has(block.id)) continue;
    selectedPoses.set(block.objectId, [...(selectedPoses.get(block.objectId) ?? []), block]);
  }
  const objectIds = [...new Set([...selectedObjectIds, ...selectedPoses.keys()])];
  return objectIds.flatMap((objectId): PoseHandleEditTarget[] => {
    const info = objectInfo(objectId);
    if (!info?.controlType) return [];
    const kinds = poseHandleKindsFor(info.controlType, info.enabledAxes);
    if (kinds.length === 0) return [];
    const poses = selectedPoses.get(objectId) ?? [];
    if (poses.length > 1) {
      return [{ objectId, blockId: null, atMs: at, kinds, blockedReason: POSE_HANDLE_CONFLICT_HINT }];
    }
    const selected = poses[0];
    if (selected) {
      const offCursor = !liveMode && selected.atMs !== at;
      return [
        {
          objectId,
          blockId: selected.id,
          atMs: selected.atMs,
          kinds,
          blockedReason: offCursor ? POSE_HANDLE_OFF_CURSOR_HINT : null,
        },
      ];
    }
    return [
      {
        objectId,
        blockId: poseBlockAt(sequence, objectId, at)?.id ?? null,
        atMs: at,
        kinds,
        blockedReason: poseHandleBlockReason(sequence, objectId, at),
      },
    ];
  });
};

const ZERO_POSE: ModelPose = { v1: 0, v2: 0, v3: 0 };

const definedAxes = (pose: KeyframePose | undefined): KeyframePose => {
  const result: KeyframePose = {};
  for (const axis of ["v1", "v2", "v3"] as const) {
    const value = pose?.[axis];
    if (value !== undefined && Number.isFinite(value)) result[axis] = value;
  }
  return result;
};

export type PoseHandleStartInput = {
  /** 改的位姿（没有就是拖的时候加） */
  block: PoseBlock | undefined;
  liveMode: boolean;
  /** 联机时这台物体的 GO 影子目标 */
  shadow: VirtualAxisValues | undefined;
  /** 3D 里这台物体正在显示的样子（不联机时就是游标处） */
  shown: ModelPose | undefined;
  /** 序列在这个位姿那一刻的样子 */
  evaluated: ModelPose | undefined;
  /** 实时位置 */
  live: ModelPose | null;
};

/**
 * 手柄从哪里起拖：联机时挂在影子上（影子就是 GO 会去的地方）；
 * 否则取 3D 正在显示的样子，位姿里设定了的轴以位姿为准。
 */
export const poseHandleStartValues = (input: PoseHandleStartInput): { values: ModelPose; onShadow: boolean } => {
  if (input.liveMode && input.shadow) {
    return {
      values: { ...ZERO_POSE, ...definedAxes(input.evaluated), ...definedAxes(input.block?.pose), ...definedAxes(input.shadow) },
      onShadow: true,
    };
  }
  const base = input.liveMode
    ? (input.evaluated ?? input.live ?? ZERO_POSE)
    : (input.shown ?? input.live ?? ZERO_POSE);
  return { values: { ...ZERO_POSE, ...definedAxes(base), ...definedAxes(input.block?.pose) }, onShadow: false };
};
