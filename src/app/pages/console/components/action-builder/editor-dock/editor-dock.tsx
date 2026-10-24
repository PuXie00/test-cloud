import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { MousePointerClick } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import type { ActionSequenceConfig, TimelineMarker } from "@/app/project/action-sequence/types";
import {
  resolveActionSequence,
  type ResolvedActionSequence,
} from "@/app/project/action-sequence/resolve-sequence";
import { sequencePathIsClosed, SEQUENCE_LOOP_DISABLED_HINT } from "@/app/project/action-sequence/sequence-loop";
import { invalidTimelineTargets } from "@/app/project/action-sequence/validate-sequence";
import { useActionBuilder } from "../use-action-builder";
import { idsInRange, resolveSelectionMode } from "../../../hooks/selection-range";
import { useSelection } from "../../../hooks/use-selection";
import {
  ClipboardContextMenu,
  clipboardShortcutOf,
  type ContextMenuAction,
} from "../action-clipboard-menu";
import { isBlockSelected, selectionBlockIds, selectionMarkerIds } from "../sequence-selection";
import {
  TIMELINE_PX_PER_SECOND_MAX,
  TIMELINE_PX_PER_SECOND_MIN,
  VIRTUAL_AXIS_IDS,
} from "../timeline/timeline-data";
import {
  availableCurveAxes,
  curveRowObjectIds,
  visibleCurveObjectIds,
} from "../timeline/curve-data";
import {
  keyframeTimesMs,
  nextKeyframeMs,
  previousKeyframeMs,
} from "../timeline/timeline-keyframes";
import { pickNiceMajorStepSec } from "../timeline/timeline-ticks";
import { TimelineEditor } from "../timeline/timeline-editor";
import { TimelineToolbar } from "../timeline/timeline-toolbar";
import { MarkerRenameDialog } from "./marker-rename-dialog";
import { SequenceDeleteDialog } from "./sequence-delete-dialog";
import { sortedMarkers } from "../marker-ops";
import { useTimelinePlayback } from "../timeline/use-timeline-playback";

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
};

const unresolvedSequenceStub = (sequence: ActionSequenceConfig): ResolvedActionSequence => ({
  id: sequence.id,
  initialPoseByObject: new Map(),
  poses: [],
  posesByObject: new Map(),
  segments: [],
  commands: [],
  totalMs: 0,
});

const SequenceEditor = () => {
  const {
    sequence,
    selection,
    timelineObjects,
    cursorMs,
    timelinePxPerSecond,
    handleSelectionChange,
    handleCursorChange,
    handlePlaybackCursorChange,
    handleMoveTimelineBlock,
    handleShiftTimelineBlocks,
    handleShiftTimelineBlocksEnd,
    handleDragPoseAxis,
    handleDragPoseAxisEnd,
    timelineViewMode: viewMode,
    handleTimelineViewModeChange: setViewMode,
    curveAxis,
    handleCurveAxisChange: setCurveAxis,
    curveGraph,
    handleCurveGraphChange,
    handleResizeDynamicPreset,
    handleBlockDelete,
    handleExplodePresets,
    handleAddMarker,
    handleShiftMarkers,
    handleShiftMarkersEnd,
    handleDeleteMarkers,
    handleBlockCopy,
    handleBlockPaste,
    canPasteBlock,
    handleTimelinePxPerSecondChange,
    handleTimelineZoomIn,
    handleTimelineZoomOut,
    handleSave,
    draftSequenceIds,
    canUndoEdit,
    canRedoEdit,
    handleUndoEdit,
    handleRedoEdit,
    handleTrajectoryModeChange,
    handleLoopChange,
    sequenceIssues,
  } = useActionBuilder();
  const { multiSelectedIds, select, toggleMulti, replaceSelection } = useSelection();

  // 左侧物体列表的点选与监控网格一致：单击选中、Ctrl/⌘ 切换、Shift 连选；经共享选中同步到 3D
  const handleObjectClick = (
    objectId: number,
    event: MouseEvent<HTMLElement>,
    rowObjectIds: readonly number[],
  ) => {
    const mode = resolveSelectionMode(event);
    if (mode === "toggle") {
      toggleMulti(objectId);
      return;
    }
    if (mode === "range") {
      replaceSelection(idsInRange(rowObjectIds, multiSelectedIds.at(-1), objectId));
      return;
    }
    select(objectId);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [fitRequestId, setFitRequestId] = useState(0);
  const [revealCursorRequestId, setRevealCursorRequestId] = useState(0);
  const [renamingMarkerId, setRenamingMarkerId] = useState<string | null>(null);
  const selectedBlockIds = selectionBlockIds(selection);
  const invalidTargets = useMemo(
    () => invalidTimelineTargets(sequenceIssues),
    [sequenceIssues],
  );

  const majorStepSec = useMemo(
    () => pickNiceMajorStepSec(timelinePxPerSecond),
    [timelinePxPerSecond],
  );

  const resolved = useMemo(() => {
    if (!sequence) return null;
    try {
      return resolveActionSequence(sequence);
    } catch {
      return null;
    }
  }, [sequence]);

  // 曲线视图的虚轴：显示的物体（选中的，没选就是全部）里有受序列控制的才能选
  const curveAxes = useMemo(() => {
    if (!sequence || !resolved) return [];
    const objectIds = visibleCurveObjectIds(curveRowObjectIds(sequence), multiSelectedIds);
    const available = availableCurveAxes(resolved, objectIds, timelineObjects);
    return VIRTUAL_AXIS_IDS.map((axis) => ({ axis, available: available.includes(axis) }));
  }, [sequence, resolved, multiSelectedIds, timelineObjects]);
  const shownCurveAxis = curveAxes.some((item) => item.axis === curveAxis && item.available)
    ? curveAxis
    : (curveAxes.find((item) => item.available)?.axis ?? curveAxis);

  const totalMs = resolved?.totalMs ?? 0;
  const canPlay = resolved !== null && totalMs > 0;

  // 选了物体时只在它们的关键帧之间跳
  const keyframes = useMemo(
    () => (sequence ? keyframeTimesMs(sequence, totalMs, multiSelectedIds) : []),
    [sequence, totalMs, multiSelectedIds],
  );
  const prevKeyframe = previousKeyframeMs(keyframes, cursorMs);
  const nextKeyframe = nextKeyframeMs(keyframes, cursorMs);
  const jumpTo = (ms: number | null) => {
    if (ms === null) return;
    handleCursorChange(ms);
    setRevealCursorRequestId((id) => id + 1);
  };
  const handleZoomFit = () => setFitRequestId((id) => id + 1);
  const handleSnapToggle = () => setSnapEnabled((enabled) => !enabled);
  const markers = useMemo(() => (sequence ? sortedMarkers(sequence) : []), [sequence]);
  const renamingMarker = markers.find((marker) => marker.id === renamingMarkerId) ?? null;
  const jumpToMarker = (marker: TimelineMarker) => {
    handleSelectionChange({ kind: "markers", markerIds: [marker.id] });
    jumpTo(marker.atMs);
  };
  const { isPlaying, toggle: handlePlayToggle } = useTimelinePlayback({
    cursorMs,
    totalMs,
    onCursorMs: handlePlaybackCursorChange ?? (() => {}),
    pauseKey: sequence,
  });

  // 直接加，不弹改名框；名字之后双击、F2 或在属性里改
  const addMarkerAtPlayhead = () => {
    handleAddMarker();
  };

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      // Ctrl/⌘+C / V 只作用于时间轴动作块，焦点在哪都一样；动作序列只能用序列库的右键菜单复制粘贴
      const shortcut = event.defaultPrevented ? null : clipboardShortcutOf(event);
      if (shortcut === "copy") {
        if (selectedBlockIds.length === 0) return;
        event.preventDefault();
        handleBlockCopy();
        return;
      }
      if (shortcut === "paste") {
        event.preventDefault();
        handleBlockPaste();
        return;
      }
      if (event.key === " " || event.code === "Space") {
        if (!canPlay && !isPlaying) return;
        event.preventDefault();
        handlePlayToggle();
        return;
      }
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          jumpTo(event.key === "ArrowLeft" ? prevKeyframe : nextKeyframe);
          return;
        }
      }
      if (plain && (event.key === "\\" || event.code === "Backslash")) {
        event.preventDefault();
        handleZoomFit();
        return;
      }
      if (plain && !event.shiftKey && (event.key.toLowerCase() === "s" || event.code === "KeyS")) {
        event.preventDefault();
        handleSnapToggle();
        return;
      }
      if (plain && !event.shiftKey && (event.key.toLowerCase() === "m" || event.code === "KeyM")) {
        event.preventDefault();
        addMarkerAtPlayhead();
        return;
      }
      const markerIds = selectionMarkerIds(selection);
      if (plain && event.key === "F2") {
        if (markerIds.length !== 1) return;
        event.preventDefault();
        setRenamingMarkerId(markerIds[0] ?? null);
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (markerIds.length > 0) {
        event.preventDefault();
        handleDeleteMarkers(markerIds);
        return;
      }
      if (selectedBlockIds.length === 0) return;
      event.preventDefault();
      handleBlockDelete();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [
    canPlay,
    handleBlockCopy,
    handleBlockDelete,
    handleBlockPaste,
    handlePlayToggle,
    isPlaying,
    selectedBlockIds.length,
    prevKeyframe,
    nextKeyframe,
    selection,
    handleAddMarker,
    handleDeleteMarkers,
  ]);

  if (!sequence) return null;

  // 选中里有预设时右键可以拆解成位姿
  const selectedPresetIds = sequence.blocks
    .filter(
      (block) =>
        (block.kind === "static-preset" || block.kind === "dynamic-preset") &&
        selectedBlockIds.includes(block.id),
    )
    .map((block) => block.id);
  const presetActions: ContextMenuAction[] =
    selectedPresetIds.length > 0
      ? [
          {
            label:
              selectedPresetIds.length > 1 ? `拆解 ${selectedPresetIds.length} 个预设` : "拆解预设",
            onSelect: () => handleExplodePresets(selectedPresetIds),
          },
        ]
      : [];

  const timelineResolved = resolved ?? unresolvedSequenceStub(sequence);

  /** 右键点在没选中的块上时先选中它，菜单里的“复制”作用于这个块 */
  const handleTimelineContextMenu = (event: MouseEvent<HTMLElement>) => {
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>("[data-block-id]") : null;
    const blockId = target?.dataset.blockId;
    if (blockId && !isBlockSelected(selection, blockId)) {
      handleSelectionChange({ kind: "block", blockId });
    }
  };

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
    >
      <TimelineToolbar
        trajectoryMode={sequence.trajectoryMode}
        onTrajectoryModeChange={handleTrajectoryModeChange}
        loop={sequence.loop === true}
        canLoop={resolved !== null && sequencePathIsClosed(resolved)}
        loopDisabledHint={SEQUENCE_LOOP_DISABLED_HINT}
        onLoopChange={handleLoopChange}
        majorStepSec={majorStepSec}
        canZoomIn={timelinePxPerSecond > TIMELINE_PX_PER_SECOND_MIN}
        canZoomOut={timelinePxPerSecond < TIMELINE_PX_PER_SECOND_MAX}
        canDelete
        canPlay={canPlay}
        isPlaying={isPlaying}
        atEnd={totalMs > 0 && cursorMs >= totalMs}
        onPlayToggle={handlePlayToggle}
        onSave={handleSave}
        canSave={sequence !== null && draftSequenceIds.has(sequence.id)}
        onUndo={handleUndoEdit}
        onRedo={handleRedoEdit}
        canUndo={canUndoEdit}
        canRedo={canRedoEdit}
        onDelete={() => setDeleteOpen(true)}
        onZoomIn={handleTimelineZoomIn}
        onZoomOut={handleTimelineZoomOut}
        onZoomFit={handleZoomFit}
        onPrevKeyframe={() => jumpTo(prevKeyframe)}
        onNextKeyframe={() => jumpTo(nextKeyframe)}
        canPrevKeyframe={prevKeyframe !== null}
        canNextKeyframe={nextKeyframe !== null}
        snapEnabled={snapEnabled}
        onSnapToggle={handleSnapToggle}
        markers={markers}
        onAddMarker={addMarkerAtPlayhead}
        onJumpToMarker={jumpToMarker}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        curveGraph={curveGraph}
        onCurveGraphChange={handleCurveGraphChange}
        curveAxis={shownCurveAxis}
        curveAxes={curveAxes}
        onCurveAxisChange={setCurveAxis}
      />
      <SequenceDeleteDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
      <MarkerRenameDialog marker={renamingMarker} onClose={() => setRenamingMarkerId(null)} />
      {resolved === null && (
        <div className="shrink-0 bg-warning-surface px-3 py-2 text-body-sm text-warning">
          预设无法解析，可继续编辑块
        </div>
      )}
      <ClipboardContextMenu
        copyLabel="复制动作块"
        pasteLabel="粘贴到播放头"
        canCopy={selectedBlockIds.length > 0}
        canPaste={canPasteBlock}
        onCopy={handleBlockCopy}
        onPaste={handleBlockPaste}
        onContextMenu={handleTimelineContextMenu}
        actions={presetActions}
      >
        <div className="flex min-h-0 flex-1">
          <TimelineEditor
            sequence={sequence}
            resolved={timelineResolved}
            objects={timelineObjects}
            selection={selection}
            cursorMs={cursorMs}
            isPlaying={isPlaying}
            timelinePxPerSecond={timelinePxPerSecond}
            onSelectionChange={handleSelectionChange}
            onCursorChange={handleCursorChange}
            onPoseMove={handleMoveTimelineBlock}
            onPresetMove={handleMoveTimelineBlock}
            onBlocksShift={handleShiftTimelineBlocks}
            onBlocksShiftEnd={handleShiftTimelineBlocksEnd}
            onDynamicPresetResize={handleResizeDynamicPreset}
            onTimelinePxPerSecondChange={handleTimelinePxPerSecondChange}
            invalidTargets={invalidTargets}
            selectedObjectIds={multiSelectedIds}
            onObjectClick={handleObjectClick}
            snapEnabled={snapEnabled}
            fitRequestId={fitRequestId}
            revealCursorRequestId={revealCursorRequestId}
            onMarkersShift={handleShiftMarkers}
            onMarkersShiftEnd={handleShiftMarkersEnd}
            onMarkerRename={(marker) => setRenamingMarkerId(marker.id)}
            viewMode={viewMode}
            curveAxis={shownCurveAxis}
            curveGraph={curveGraph}
            onPoseAxisDrag={handleDragPoseAxis}
            onPoseAxisDragEnd={handleDragPoseAxisEnd}
          />
        </div>
      </ClipboardContextMenu>
    </div>
  );
};

/**
 * 编辑坞：随动作序列库选中项变形 — 动作 → 时间轴。
 */
export const EditorDock = ({ className }: { className?: string }) => {
  const { dockMode } = useActionBuilder();

  return (
    <div
      className={cn(
        "flex h-[280px] shrink-0 flex-col overflow-hidden rounded-lg bg-card",
        className,
      )}
    >
      {dockMode === "sequence" && <SequenceEditor />}
      {dockMode === "empty" && (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-body-sm text-muted-foreground">
          <MousePointerClick className="h-4 w-4" aria-hidden />
          在右侧动作序列库选择动作进行编辑
        </div>
      )}
    </div>
  );
};
