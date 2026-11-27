import { useEffect, useMemo, useRef, useState } from "react";
import {
  resolveActionSequence,
  uncontrolledAxesOf,
  type ResolvedActionSequence,
} from "@/app/project/action-sequence/resolve-sequence";
import type { ModelPose } from "@/app/project/action-sequence/types";
import { invalidTimelineTargets } from "@/app/project/action-sequence/validate-sequence";
import type { MotionPathEntry, MotionPathMode, MotionPathPickEvent } from "@/app/viz3d/pose-handles/motion-path-types";
import {
  buildMotionPathEntries,
  motionPathObjectIds,
  motionPathSampleStepMs,
  posesAtSafe,
  sampleMotionPaths,
} from "../components/action-builder/motion-path-entries";
import {
  followedObjectIds,
  segmentSelection,
  selectionBlockIds,
  type SequenceSelection,
} from "../components/action-builder/sequence-selection";
import { snapTimeMs } from "../components/action-builder/timeline/timeline-data";
import { blockObjectIds } from "../components/action-builder/timeline/timeline-snap";
import { useActionBuilder } from "../components/action-builder/use-action-builder";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useSelection } from "../hooks/use-selection";
import { useSequencePreview } from "../hooks/use-sequence-preview";
import { useActionPreviewPoses } from "./use-action-preview-poses";
import { useViz3DContext } from "./Viz3DProvider";
import { resolveMonitorObjectIds } from "./viz3d-selection-sync";

const resolveOrNull = (sequence: Parameters<typeof resolveActionSequence>[0] | null): ResolvedActionSequence | null => {
  if (!sequence) return null;
  try {
    return resolveActionSequence(sequence);
  } catch {
    return null;
  }
};

/**
 * 动作页 3D 里看整条动作：选中物体（视图菜单「轨迹」里可改成全部或关）的轨迹和位姿点、
 * 游标亮点、有问题的段和物体标红；
 * 点位姿点选中那个位姿，点轨迹线游标跳到那一刻（点在有问题的段上同时选中那段）。
 */
export const Viz3DMotionPathSync = () => {
  const engine = useViz3DContext();
  const { activeNav } = useConsoleNav();
  const { sequenceId: programPreviewId } = useSequencePreview();
  const builder = useActionBuilder();
  const { sequence, selection, selectedObjectIds, cursorMs, sequenceIssues } = builder;
  const shown = useActionPreviewPoses();
  const { selectedId, multiSelectedIds, replaceSelection } = useSelection();
  const [mode, setMode] = useState<MotionPathMode>(() => engine.getMotionPathMode());

  useEffect(() => {
    const handleMode = (next: MotionPathMode) => setMode(next);
    engine.events.on("motionPathModeChange", handleMode);
    setMode(engine.getMotionPathMode());
    return () => engine.events.off("motionPathModeChange", handleMode);
  }, [engine]);

  const active = activeNav === "sequences" && programPreviewId === null && sequence !== null && mode !== "off";
  const resolved = useMemo(() => (active ? resolveOrNull(sequence) : null), [active, sequence]);
  const selectedBlockIds = useMemo(() => new Set(selectionBlockIds(selection)), [selection]);
  const objectIds = useMemo(() => {
    if (!resolved || !sequence) return [];
    return motionPathObjectIds({
      mode,
      sequenceObjectIds: [...resolved.posesByObject.keys()],
      selectedObjectIds,
      selectedBlockObjectIds: sequence.blocks
        .filter((block) => selectedBlockIds.has(block.id))
        .flatMap(blockObjectIds),
    });
  }, [resolved, sequence, mode, selectedObjectIds, selectedBlockIds]);
  const invalid = useMemo(() => invalidTimelineTargets(sequenceIssues), [sequenceIssues]);
  // 取样跟序列和画哪些物体走：拖游标不重算
  const samples = useMemo(() => {
    if (!resolved) return null;
    try {
      return sampleMotionPaths(resolved, objectIds, motionPathSampleStepMs(resolved.totalMs));
    } catch {
      return null;
    }
  }, [resolved, objectIds]);

  const trajectoryEntries = useMemo(() => {
    if (!resolved || !samples) return [];
    // 轨迹只是辅助显示：算出错就不画，不能连累整个页面
    try {
      return buildMotionPathEntries({
        resolved,
        samples,
        cursorPoses: posesAtSafe(resolved, cursorMs),
        cursorMs,
        objectIds,
        selectedObjectIds: new Set(selectedObjectIds),
        selectedBlockIds,
        invalid,
        pinnedAxes: (objectId) => {
          const live = shown.get(objectId);
          const pinned: Partial<ModelPose> = {};
          for (const axis of uncontrolledAxesOf(resolved, objectId)) {
            const value = live?.[axis];
            if (value !== undefined) pinned[axis] = value;
          }
          return pinned;
        },
        engineIdOf: (objectId) => engine.resolveObjectId(String(objectId)) ?? String(objectId),
      });
    } catch {
      return [];
    }
  }, [resolved, samples, cursorMs, objectIds, selectedObjectIds, selectedBlockIds, invalid, shown, engine]);

  const entries = useMemo(() => {
    const contacts = builder.collisionObjectIds;
    if (activeNav !== "sequences" || programPreviewId !== null || !contacts?.length) return trajectoryEntries;
    const remaining = new Map(contacts.map((id) => [engine.resolveObjectId(String(id)) ?? String(id), id]));
    const result: MotionPathEntry[] = trajectoryEntries.map((entry) =>
      remaining.delete(entry.objectId) ? { ...entry, issueAtCursor: true } : entry,
    );
    // 静态布景和只随父物体运动的子件也能高亮，即便没有自己的轨迹。
    for (const [objectId, id] of remaining) {
      result.push({ objectId, selected: false, issues: [], issueAtCursor: true, samples: [], keyframes: [],
        cursor: { atMs: cursorMs, values: shown.get(id) ?? {} } });
    }
    return result;
  }, [trajectoryEntries, builder.collisionObjectIds, activeNav, programPreviewId, cursorMs, shown, engine]);

  useEffect(() => {
    engine.setMotionPaths(entries);
  }, [engine, entries]);

  useEffect(() => () => engine.setMotionPaths([]), [engine]);

  const latestRef = useRef({ builder, resolved, sequence, selectedId, multiSelectedIds, replaceSelection });
  latestRef.current = { builder, resolved, sequence, selectedId, multiSelectedIds, replaceSelection };

  useEffect(() => {
    // 选中跟时间轴上点一样：物体跟着块走（3D、左侧轨道、手动控制都对上）
    const select = (next: SequenceSelection) => {
      const current = latestRef.current;
      current.builder.handleSelectionChange(next);
      if (!current.sequence) return;
      const objectIds = followedObjectIds(
        current.sequence,
        next,
        "replace",
        resolveMonitorObjectIds(current.selectedId, current.multiSelectedIds),
      );
      if (objectIds === null) return;
      current.builder.handleObjectsFollow(objectIds);
      current.replaceSelection(objectIds);
    };
    const handlePick = (event: MotionPathPickEvent) => {
      const current = latestRef.current;
      if (event.kind === "keyframe") {
        // 游标跟不跟过去按「选中位姿游标跟随」开关（编辑坞里统一处理）
        select({ kind: "block", blockId: event.blockId });
        return;
      }
      current.builder.handleCursorChange(snapTimeMs(event.atMs), { reveal: true });
      const segment = event.segmentKey
        ? current.resolved?.segments.find((entry) => entry.key === event.segmentKey)
        : undefined;
      if (segment && current.resolved) select(segmentSelection(current.resolved, segment));
    };
    engine.events.on("motionPathPick", handlePick);
    return () => engine.events.off("motionPathPick", handlePick);
  }, [engine]);

  return null;
};
