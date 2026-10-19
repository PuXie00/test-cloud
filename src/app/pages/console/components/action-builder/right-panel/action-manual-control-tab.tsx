import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import type { CapturedPoseRequest } from "@/app/project/capture-pose-sequence";
import { isGoStarting, positionsToAxisValues } from "../../../hooks/go-ready";
import { useGoReady } from "../../../hooks/go-ready-provider";
import { useControlledObjects } from "../../../hooks/use-controlled-objects";
import { useProjectStore } from "../../../hooks/use-project-store";
import { buildDimensionParticipants } from "../../right-tab-panel/manual-control-tab/dimension-edit";
import { ManualControlPanel } from "../../right-tab-panel/manual-control-tab/manual-control-panel";
import {
  LIVE_POSE_CONFLICT_NOTICE,
  LIVE_POSE_MOVING_NOTICE,
  buildPoseGoBindings,
  captureLabel,
  livePoseBindingKey,
  livePoseLabel,
  resolveLivePoseSelection,
} from "../live-pose-edit";
import { useActionBuilder } from "../use-action-builder";

/**
 * 动作页手动控制 =「当前位置」打开的联机编辑：
 * - 选中的位姿成为 GO 目标（影子停在位姿上），手动控制操作这些位姿的物体
 * - 「取当前」把实时位置写进选中位姿；没选位姿时写到播放头，没选序列则新建序列（不加入节目）
 */
export const ActionManualControlTab = () => {
  const { sequence, selection, cursorMs, handleSaveCurrentPose, handleUpdatePosesFromLive } =
    useActionBuilder();
  const { getById } = useControlledObjects();
  const { objects } = useProjectStore();
  const { state, bind } = useGoReady();

  const live = useMemo(() => resolveLivePoseSelection(sequence, selection), [sequence, selection]);
  const poses = live.kind === "poses" ? live.poses : [];

  // 遥测每帧都刷新，GO 目标只在位姿或「有没有位置数据」变化时重设
  const posesRef = useRef(poses);
  posesRef.current = poses;
  const getByIdRef = useRef(getById);
  getByIdRef.current = getById;
  const bindingKey = `${livePoseBindingKey(poses)}#${poses
    .map((block) => (getById(block.objectId)?.positions ? 1 : 0))
    .join("")}`;

  useEffect(() => {
    const current = posesRef.current;
    if (current.length === 0) {
      bind(null);
      return;
    }
    const snapshots = current.flatMap((block) => {
      const snapshot = getByIdRef.current(block.objectId);
      return snapshot ? [snapshot] : [];
    });
    bind(buildPoseGoBindings(current, buildDimensionParticipants(snapshots, objects)));
  }, [bindingKey, objects, bind]);

  useEffect(() => () => bind(null), [bind]);

  // 遥测报运动中，或刚按了 GO 遥测还没报上来，都不能取当前
  const boundIds = new Set(poses.map((block) => String(block.objectId)));
  const moving =
    poses.some((block) => getById(block.objectId)?.descriptor.status === "running") ||
    state.entries.some((entry) => boundIds.has(entry.objectId) && isGoStarting(entry));
  const saveBlockedReason =
    live.kind === "conflict"
      ? LIVE_POSE_CONFLICT_NOTICE
      : live.kind === "poses" && moving
        ? LIVE_POSE_MOVING_NOTICE
        : null;

  const handleSave = (request: CapturedPoseRequest) => {
    if (live.kind !== "poses") {
      handleSaveCurrentPose(request);
      return;
    }
    const liveFor = (objectId: number) => {
      const values = positionsToAxisValues(getById(objectId)?.positions ?? null);
      return Object.keys(values).length > 0 ? values : null;
    };
    if (poses.every((block) => liveFor(block.objectId) === null)) {
      toast.error("所选物体没有位置数据，无法取当前");
      return;
    }
    handleUpdatePosesFromLive(
      poses.map((block) => block.id),
      liveFor,
    );
  };

  return (
    <ManualControlPanel
      objectIds={live.kind === "poses" ? poses.map((block) => block.objectId) : undefined}
      liveLabel={live.kind === "poses" ? livePoseLabel(poses) : null}
      saveLabel={captureLabel(live, sequence, cursorMs)}
      saveBlockedReason={saveBlockedReason}
      onSaveCurrentPose={handleSave}
    />
  );
};
