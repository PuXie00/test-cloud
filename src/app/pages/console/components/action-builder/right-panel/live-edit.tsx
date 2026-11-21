import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { usePermissions } from "@/app/auth/permissions";
import type { CapturedPoseRequest } from "@/app/project/capture-pose-sequence";
import { isGoStarting, pendingGoEntries, positionsToAxisValues } from "../../../hooks/go-ready";
import { useGoReady } from "../../../hooks/go-ready-provider";
import { useControlledObjects } from "../../../hooks/use-controlled-objects";
import { useProjectStore } from "../../../hooks/use-project-store";
import { useSelection } from "../../../hooks/use-selection";
import { buildDimensionParticipants } from "../../right-tab-panel/manual-control-tab/dimension-edit";
import { resolveManualControlAvailability } from "../../right-tab-panel/manual-control-tab/manual-control-availability";
import { poseFromControlSnapshot } from "../../right-tab-panel/manual-control-tab/pose-from-control-snapshot";
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
 * 「当前位置」开着时：选中的位姿成为 GO 目标（影子停在位姿上），在哪个页签都一样。
 * 只在动作页、联机时挂着；关掉联机就解除绑定。
 */
export const LivePoseGoBinding = () => {
  const { sequence, selection } = useActionBuilder();
  const { getById } = useControlledObjects();
  const { objects } = useProjectStore();
  const { bind } = useGoReady();
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
  return null;
};

/** 联机时「取当前」：写到哪里、能不能写、怎么写（手动控制页和属性页共用） */
export const useLiveCapture = () => {
  const { sequence, selection, cursorMs, handleSaveCurrentPose, handleUpdatePosesFromLive } =
    useActionBuilder();
  const { getById } = useControlledObjects();
  const { state } = useGoReady();
  const live = useMemo(() => resolveLivePoseSelection(sequence, selection), [sequence, selection]);
  const poses = live.kind === "poses" ? live.poses : [];

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

  const save = (request: CapturedPoseRequest) => {
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

  return {
    live,
    poses,
    saveLabel: captureLabel(live, sequence, cursorMs),
    saveBlockedReason,
    liveLabel: live.kind === "poses" ? livePoseLabel(poses) : null,
    save,
  };
};

const stripButtonClass =
  "h-8 rounded-md px-3 text-body-sm font-semibold disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:h-10";

/**
 * 属性页顶上的联机条（「当前位置」开着时）：取当前写到哪里、GO 要多久。
 * 点动和维度控制还在「手动控制」页；GO 还是按 3D 下面的 GO 条。
 */
export const LiveEditStrip = ({ onSaveShape }: { onSaveShape?: (request: CapturedPoseRequest) => void }) => {
  const { live, poses, saveLabel, saveBlockedReason, liveLabel, save } = useLiveCapture();
  const { selectedId, multiSelectedIds } = useSelection();
  const { getById, snapshots: allSnapshots } = useControlledObjects();
  const { state, plan } = useGoReady();
  const canWritePose = usePermissions().can("action.edit");

  const objectIds =
    live.kind === "poses"
      ? poses.map((block) => block.objectId)
      : multiSelectedIds.length > 0
        ? multiSelectedIds
        : selectedId != null
          ? [selectedId]
          : [];
  const snapshots = objectIds.flatMap((id) => {
    const snapshot = getById(id);
    return snapshot ? [snapshot] : [];
  });
  const availability = resolveManualControlAvailability(
    snapshots.map((snapshot) => ({ name: snapshot.descriptor.name, status: snapshot.descriptor.status })),
    null,
  );
  const canSave = objectIds.length > 0 && !saveBlockedReason && availability.allowed("savePose");
  const pending = pendingGoEntries(state.entries).length;

  const poseForObject = (objectId: number) => {
    const snapshot = getById(objectId);
    return snapshot ? poseFromControlSnapshot(snapshot) : null;
  };
  const handleSave = () => save({ objectIds, poseForObject });
  // 存为造型：选中的物体；没选就存所有有位置数据的物体
  const shapeIds =
    objectIds.length > 0
      ? objectIds
      : (allSnapshots ?? []).filter((snapshot) => snapshot.positions).map((snapshot) => snapshot.descriptor.id);

  return (
    <section aria-label="联机" className="shrink-0 bg-primary/10 px-3 py-2">
      <p className="truncate text-body-sm font-semibold text-primary">
        {liveLabel ?? "当前位置开着：选中的位姿就是 GO 目标"}
      </p>
      {canWritePose ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canSave}
            onClick={handleSave}
            className={`${stripButtonClass} bg-primary text-primary-foreground`}
          >
            {saveLabel}
          </button>
          {onSaveShape ? (
            <button
              type="button"
              disabled={shapeIds.length === 0}
              onClick={() => onSaveShape({ objectIds: shapeIds, poseForObject })}
              className={`${stripButtonClass} border border-border text-foreground hover:bg-accent`}
            >
              存为造型
            </button>
          ) : null}
        </div>
      ) : null}
      {saveBlockedReason ? <p className="mt-1 text-body-sm text-warning">{saveBlockedReason}</p> : null}
      {pending > 0 ? (
        <p className="mt-1 text-body-sm text-muted-foreground">
          GO
          {plan.totalSeconds !== null ? (
            <span className="font-mono tabular-nums text-foreground"> 约 {plan.totalSeconds.toFixed(1)} s</span>
          ) : null}
          ，在 3D 下面的 GO 条执行
        </p>
      ) : null}
    </section>
  );
};
