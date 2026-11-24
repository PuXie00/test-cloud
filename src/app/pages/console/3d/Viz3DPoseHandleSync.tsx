import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { usePermissions } from "@/app/auth/permissions";
import { evaluateResolvedSequence } from "@/app/project/action-sequence/evaluate-sequence";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ModelPose, PoseBlock } from "@/app/project/action-sequence/types";
import type { VirtualAxisId, VirtualAxisValues } from "@/app/project/project-document-types";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import type { PoseHandleTarget } from "@/app/viz3d/pose-handles/pose-handle-types";
import {
  poseHandleStartValues,
  resolvePoseHandleEditTargets,
  type PoseHandleEditTarget,
} from "../components/action-builder/pose-handle-targets";
import { useActionBuilder } from "../components/action-builder/use-action-builder";
import {
  formatVirtualAxisCompact,
  getVirtualAxisMeta,
} from "../components/action-builder/virtual-axis-display";
import { useGoReady } from "../hooks/go-ready-provider";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useSequencePreview } from "../hooks/use-sequence-preview";
import { useActionPreviewPoses } from "./use-action-preview-poses";
import { useViz3DContext } from "./Viz3DProvider";
import { toProjectObjectIds } from "./viz3d-selection-sync";

const evaluateAt = (
  resolved: ReturnType<typeof resolveActionSequence> | null,
  atMs: number,
): Map<number, ModelPose> => {
  if (!resolved) return new Map();
  try {
    return evaluateResolvedSequence(resolved, atMs);
  } catch {
    return new Map();
  }
};

/**
 * 动作页 3D 位姿手柄：选中的物体（和选中位姿的物体）上出手柄，拖手柄直接改位姿；
 * 3D 里点物体选它游标处的位姿，双击跳到它最近的位姿。只改位姿，从不直接动设备。
 */
export const Viz3DPoseHandleSync = () => {
  const engine = useViz3DContext();
  const { activeNav } = useConsoleNav();
  const { sequenceId: programPreviewId } = useSequencePreview();
  const builder = useActionBuilder();
  const {
    sequence,
    selection,
    selectedObjectIds,
    cursorMs,
    liveMode,
    timelinePlaying,
    getTimelineObject,
    getLivePose,
  } = builder;
  const canEdit = usePermissions().can("action.edit");
  const display = useSessionDisplayLengthUnit();
  const shown = useActionPreviewPoses();
  const { state: goState } = useGoReady();

  // 3D 里点选在动作页、打开了序列、不在预览节目时都管；手柄还要能编辑、时间轴没在播放
  const pickActive = activeNav === "sequences" && programPreviewId === null && sequence !== null;
  const handlesActive = pickActive && canEdit && !timelinePlaying;

  const editTargets = useMemo(
    (): PoseHandleEditTarget[] =>
      handlesActive && sequence
        ? resolvePoseHandleEditTargets({
            sequence,
            selection,
            selectedObjectIds,
            cursorMs,
            liveMode,
            objectInfo: (objectId) => {
              const object = getTimelineObject(objectId);
              return object ? { controlType: object.controlType, enabledAxes: object.enabledAxes } : undefined;
            },
          })
        : [],
    [handlesActive, sequence, selection, selectedObjectIds, cursorMs, liveMode, getTimelineObject],
  );

  const resolved = useMemo(() => {
    if (!sequence || editTargets.length === 0) return null;
    try {
      return resolveActionSequence(sequence);
    } catch {
      return null;
    }
  }, [sequence, editTargets.length]);

  const shadowTargets = useMemo(
    () => new Map<string, VirtualAxisValues>(goState.entries.map((entry) => [entry.objectId, entry.target])),
    [goState.entries],
  );

  const engineTargets = useMemo((): PoseHandleTarget[] => {
    const evaluatedByTime = new Map<number, Map<number, ModelPose>>();
    const evaluatedAt = (atMs: number) => {
      const cached = evaluatedByTime.get(atMs);
      if (cached) return cached;
      const next = evaluateAt(resolved, atMs);
      evaluatedByTime.set(atMs, next);
      return next;
    };
    return editTargets.map((target) => {
      const object = getTimelineObject(target.objectId);
      const block = sequence?.blocks.find(
        (item): item is PoseBlock => item.kind === "pose" && item.id === target.blockId,
      );
      const engineId = engine.resolveObjectId(String(target.objectId)) ?? String(target.objectId);
      const start = poseHandleStartValues({
        block,
        liveMode,
        shadow: shadowTargets.get(engineId) ?? shadowTargets.get(String(target.objectId)),
        shown: shown.get(target.objectId),
        evaluated: evaluatedAt(target.atMs).get(target.objectId),
        live: getLivePose(target.objectId),
      });
      const controlType = object?.controlType;
      const format = (axis: VirtualAxisId, value: number) =>
        formatVirtualAxisCompact(axis, value, display, undefined, controlType);
      return {
        objectId: engineId,
        kinds: target.kinds,
        values: start.values,
        ranges: object?.rangeByAxis,
        onShadow: start.onShadow,
        blockedReason: target.blockedReason,
        describe: (axis, value, delta) =>
          `${getVirtualAxisMeta(axis, controlType).label} ${format(axis, value)} ${delta < 0 ? "−" : "+"}${format(axis, Math.abs(delta))}`,
      };
    });
  }, [editTargets, sequence, resolved, liveMode, shadowTargets, shown, getLivePose, getTimelineObject, display, engine]);

  useEffect(() => {
    engine.setPoseHandles(engineTargets);
  }, [engine, engineTargets]);

  useEffect(() => () => engine.setPoseHandles([]), [engine]);

  // 播放开始、离开动作页时手里还拖着就放弃
  useEffect(() => {
    if (!handlesActive) engine.cancelPoseHandleDrag();
  }, [engine, handlesActive]);

  const latestRef = useRef({ builder, editTargets, pickActive });
  latestRef.current = { builder, editTargets, pickActive };

  useEffect(() => {
    const toProjectId = (id: string) => Number(engine.resolveSnapshotId(id) ?? id);

    const onDragStart = ({ objectIds }: { objectIds: string[] }) => {
      const { builder: current, editTargets: targets } = latestRef.current;
      const picked = objectIds.flatMap((id) => {
        const target = targets.find((entry) => entry.objectId === toProjectId(id));
        return target ? [{ objectId: target.objectId, blockId: target.blockId, atMs: target.atMs }] : [];
      });
      if (!current.handlePoseHandleDragStart(picked)) engine.cancelPoseHandleDrag();
    };
    const onDrag = ({ updates }: { updates: Array<{ objectId: string; values: Partial<Record<VirtualAxisId, number>> }> }) => {
      latestRef.current.builder.handlePoseHandleDrag(
        updates.map((update) => ({ objectId: toProjectId(update.objectId), values: update.values })),
      );
    };
    const onDragEnd = ({ cancelled }: { cancelled: boolean }) => {
      latestRef.current.builder.handlePoseHandleDragEnd(!cancelled);
    };
    const onBlocked = ({ reason }: { reason: string }) => {
      toast.info(reason, { id: "pose-handle-blocked" });
    };

    // 引擎在一次点选里先发 selectionChange 再发 objectClick / boxSelect：记下这次点选改没改选中
    // （改了的话全局选中随后会同步回动作编辑器，要认出是这一次）
    let selectionChanged = false;
    const onSelectionChange = () => {
      selectionChanged = true;
      queueMicrotask(() => {
        selectionChanged = false;
      });
    };
    const onPick = () => {
      const changed = selectionChanged;
      selectionChanged = false;
      if (!latestRef.current.pickActive) return;
      const ids = toProjectObjectIds(engine.getSelection(), (id) => engine.resolveSnapshotId(id));
      latestRef.current.builder.handleViewportObjectsPick(ids, changed);
    };
    const onDoubleClick = ({ id }: { id: string | null }) => {
      if (!latestRef.current.pickActive || id === null) return;
      latestRef.current.builder.handleViewportObjectDoubleClick(toProjectId(id));
    };

    engine.events.on("poseHandleDragStart", onDragStart);
    engine.events.on("poseHandleDrag", onDrag);
    engine.events.on("poseHandleDragEnd", onDragEnd);
    engine.events.on("poseHandleBlocked", onBlocked);
    engine.events.on("selectionChange", onSelectionChange);
    engine.events.on("objectClick", onPick);
    engine.events.on("boxSelect", onPick);
    engine.events.on("objectDoubleClick", onDoubleClick);
    return () => {
      engine.events.off("poseHandleDragStart", onDragStart);
      engine.events.off("poseHandleDrag", onDrag);
      engine.events.off("poseHandleDragEnd", onDragEnd);
      engine.events.off("poseHandleBlocked", onBlocked);
      engine.events.off("selectionChange", onSelectionChange);
      engine.events.off("objectClick", onPick);
      engine.events.off("boxSelect", onPick);
      engine.events.off("objectDoubleClick", onDoubleClick);
    };
  }, [engine]);

  return null;
};
