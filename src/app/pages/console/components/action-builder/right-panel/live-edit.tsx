import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { evaluateResolvedSequence } from "@/app/project/action-sequence/evaluate-sequence";
import {
  resolveActionSequence,
  uncontrolledAxesOf,
  type ResolvedActionSequence,
} from "@/app/project/action-sequence/resolve-sequence";
import type { KeyframePose } from "@/app/project/action-sequence/types";
import type { CapturedPoseRequest } from "@/app/project/capture-pose-sequence";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { roundProjectCoordinate } from "@/app/project/project-quantity";
import { isExplicitGoEntry, isGoStarting, positionsToAxisValues } from "../../../hooks/go-ready";
import { useGoReady } from "../../../hooks/go-ready-provider";
import { useControlledObjects } from "../../../hooks/use-controlled-objects";
import { useProjectStore } from "../../../hooks/use-project-store";
import { buildDimensionParticipants } from "../../right-tab-panel/manual-control-tab/dimension-edit";
import {
  CURSOR_SHADOW_HINT,
  LIVE_POSE_CONFLICT_NOTICE,
  LIVE_POSE_HINT,
  LIVE_POSE_MOVING_NOTICE,
  buildCursorGoBindings,
  buildPoseGoBindings,
  captureLabel,
  cursorShadowLabel,
  cursorShadowObjectIds,
  livePoseBindingKey,
  livePoseLabel,
  resolveLivePoseSelection,
} from "../live-pose-edit";
import { useActionBuilder } from "../use-action-builder";

const AXES: readonly VirtualAxisId[] = ["v1", "v2", "v3"];

const resolveOrNull = (sequence: Parameters<typeof resolveActionSequence>[0] | null): ResolvedActionSequence | null => {
  if (!sequence) return null;
  try {
    return resolveActionSequence(sequence);
  } catch {
    return null;
  }
};

/**
 * 没选位姿时影子跟着游标：游标处序列的样子（选中的物体，没选就是序列里全部物体，只含序列控制的轴）。
 * 选着位姿、同一物体选了几个时刻，或没打开序列时为 null。
 */
const useCursorShadow = () => {
  const { sequence, selection, cursorMs, selectedObjectIds } = useActionBuilder();
  const live = useMemo(() => resolveLivePoseSelection(sequence, selection), [sequence, selection]);
  const resolved = useMemo(() => (live.kind === "none" ? resolveOrNull(sequence) : null), [live.kind, sequence]);
  return useMemo(() => {
    if (!resolved) return null;
    const objectIds = cursorShadowObjectIds([...resolved.posesByObject.keys()], selectedObjectIds ?? []);
    const evaluated = evaluateResolvedSequence(resolved, cursorMs);
    const poses = new Map<number, KeyframePose>();
    for (const objectId of objectIds) {
      const pose = evaluated.get(objectId);
      if (!pose) continue;
      const uncontrolled = uncontrolledAxesOf(resolved, objectId);
      const keyframe: KeyframePose = {};
      for (const axis of AXES) {
        if (!uncontrolled.includes(axis)) keyframe[axis] = roundProjectCoordinate(pose[axis]);
      }
      if (Object.keys(keyframe).length > 0) poses.set(objectId, keyframe);
    }
    return poses.size > 0 ? { cursorMs, poses } : null;
  }, [resolved, selectedObjectIds, cursorMs]);
};

/**
 * 「当前位置」开着（在「手动控制」页）时影子就是按 GO 会去的地方：
 * - 选了位姿：影子停在位姿上；
 * - 没选位姿：影子是游标处序列的样子，拖游标跟着走（播放时不跟），按 GO 走到这一帧；
 *   刚打开时已经有点名要去的目标（去这里、维度控制填的）先不盖掉，拖了游标再跟。
 * 只设目标，不下发；只在动作页、联机时挂着，关掉联机就解除绑定。
 */
export const LivePoseGoBinding = () => {
  const { sequence, selection, timelinePlaying } = useActionBuilder();
  const { getById } = useControlledObjects();
  const { objects } = useProjectStore();
  const { bind, state } = useGoReady();
  const live = useMemo(() => resolveLivePoseSelection(sequence, selection), [sequence, selection]);
  const poses = live.kind === "poses" ? live.poses : [];
  const shadow = useCursorShadow();

  // 遥测每帧都刷新，GO 目标只在位姿（或游标处的样子）、「有没有位置数据」变化时重设
  const latestRef = useRef({ poses, shadow, getById, state });
  latestRef.current = { poses, shadow, getById, state };
  const objectIds = live.kind === "poses" ? poses.map((block) => block.objectId) : [...(shadow?.poses.keys() ?? [])];
  const positionsKey = objectIds.map((objectId) => (getById(objectId)?.positions ? 1 : 0)).join("");
  const bindingKey =
    live.kind === "poses"
      ? `pose:${livePoseBindingKey(poses)}#${positionsKey}`
      : shadow
        ? `cursor:${shadow.cursorMs}:${[...shadow.poses]
            .map(([objectId, pose]) => `${objectId}=${pose.v1 ?? ""},${pose.v2 ?? ""},${pose.v3 ?? ""}`)
            .join("|")}#${positionsKey}`
        : "none";
  const followingRef = useRef(false);

  useEffect(() => {
    const { poses: currentPoses, shadow: currentShadow, getById: lookup, state: goState } = latestRef.current;
    const participantsOf = (ids: readonly number[]) =>
      buildDimensionParticipants(
        ids.flatMap((objectId) => {
          const snapshot = lookup(objectId);
          return snapshot ? [snapshot] : [];
        }),
        objects,
      );
    if (currentPoses.length > 0) {
      followingRef.current = false;
      bind(buildPoseGoBindings(currentPoses, participantsOf(currentPoses.map((block) => block.objectId))));
      return;
    }
    if (!currentShadow) {
      followingRef.current = false;
      bind(null);
      return;
    }
    // 播放中不跟着游标走，停下再按停下的这一帧
    if (timelinePlaying) return;
    const first = !followingRef.current;
    followingRef.current = true;
    if (first && goState.entries.some((entry) => !entry.dispatched && isExplicitGoEntry(entry))) return;
    bind(
      buildCursorGoBindings(currentShadow.poses, participantsOf([...currentShadow.poses.keys()]), currentShadow.cursorMs),
      { exclusive: true },
    );
  }, [bindingKey, timelinePlaying, objects, bind]);

  useEffect(() => () => bind(null), [bind]);
  return null;
};

/** 联机时「取当前」：写到哪里、能不能写、怎么写（手动控制页和属性页共用） */
export const useLiveCapture = () => {
  const {
    sequence,
    selection,
    cursorMs,
    handleSaveCurrentPose,
    handleUpdatePosesFromLive,
    handleApplyPoseAxisWrite,
  } = useActionBuilder();
  const { getById } = useControlledObjects();
  const { state } = useGoReady();
  const live = useMemo(() => resolveLivePoseSelection(sequence, selection), [sequence, selection]);
  const poses = live.kind === "poses" ? live.poses : [];
  const shadow = useCursorShadow();

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

  const liveFor = (objectId: number) => {
    const values = positionsToAxisValues(getById(objectId)?.positions ?? null);
    return Object.keys(values).length > 0 ? values : null;
  };

  const save = (request: CapturedPoseRequest) => {
    if (live.kind !== "poses") {
      handleSaveCurrentPose(request);
      return;
    }
    if (poses.every((block) => liveFor(block.objectId) === null)) {
      toast.error("所选物体没有位置数据，无法取当前");
      return;
    }
    handleUpdatePosesFromLive(
      poses.map((block) => block.id),
      liveFor,
    );
  };

  const poseIds = poses.map((block) => block.id);
  return {
    live,
    poses,
    saveLabel: captureLabel(live, sequence, cursorMs),
    saveBlockedReason,
    liveLabel:
      live.kind === "poses"
        ? livePoseLabel(poses)
        : shadow
          ? cursorShadowLabel(shadow.cursorMs, shadow.poses.size)
          : null,
    liveHint: live.kind === "poses" ? LIVE_POSE_HINT : shadow ? CURSOR_SHADOW_HINT : null,
    save,
    /** 选着位姿时维度控制直接改位姿（影子跟着动，可撤销）；没选位姿时为 undefined（改的是手动目标） */
    writePoseAxis:
      live.kind === "poses"
        ? (write: { mode: "abs" | "rel"; axis: VirtualAxisId; value: number }) =>
            handleApplyPoseAxisWrite(poseIds, write)
        : undefined,
    /** 选着位姿时单轴取当前：只把这一根轴的实时位置写进位姿 */
    captureAxis:
      live.kind === "poses" && !saveBlockedReason
        ? (axis: VirtualAxisId) =>
            handleUpdatePosesFromLive(poseIds, (objectId) => {
              const value = liveFor(objectId)?.[axis];
              return value === undefined ? null : { [axis]: value };
            })
        : undefined,
  };
};
