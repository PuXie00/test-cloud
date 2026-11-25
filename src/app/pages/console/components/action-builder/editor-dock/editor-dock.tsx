import { usePermissions } from "@/app/auth/permissions";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { MousePointerClick } from "lucide-react";
import { toast } from "sonner";
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
import { useRunningActionIds } from "../../../hooks/action-run";
import { runningSequenceMessage } from "@/app/project/running-sequence-lock";
import {
  ClipboardContextMenu,
  clipboardShortcutOf,
  type ContextMenuAction,
} from "../action-clipboard-menu";
import {
  followedObjectIds,
  isBlockSelected,
  segmentSelection,
  selectionBlockIds,
  selectionMarkerIds,
  type ObjectFollow,
  type SequenceSelection,
  selectedPosesTimeMs,
  selectedSegmentsOf,
} from "../sequence-selection";
import { VIRTUAL_AXIS_IDS, secondsToMs } from "../timeline/timeline-data";
import { uniformDurationWrites } from "../right-panel/segment-retime";
import { blocksSpanMs } from "../sequence-ops";
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
import { TimelineEditor } from "../timeline/timeline-editor";
import { TimelineToolbar } from "../timeline/timeline-toolbar";
import { MarkerRenameDialog } from "./marker-rename-dialog";
import { SecondsPromptDialog, type SecondsPrompt } from "./seconds-prompt-dialog";
import { ScalePromptDialog, type ScalePrompt } from "./scale-prompt-dialog";
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
    cursorRevealRequestId,
    timelinePxPerSecond,
    handleSelectionChange,
    handleObjectsFollow,
    handleCursorChange,
    handlePlaybackCursorChange,
    handleTimelinePlayingChange,
    handleMoveTimelineBlock,
    handleShiftTimelineBlocks,
    handleShiftTimelineBlocksEnd,
    handleScaleTimelineBlocks,
    handleScaleTimelineBlocksEnd,
    handleInsertSpeedPoints,
    handleInsertSequenceRef,
    handleExplodeSequenceRefs,
    handleSequenceSelect,
    sequences,
    handleDragPoseAxis,
    handleDragPoseAxisEnd,
    timelineViewMode: viewMode,
    handleTimelineViewModeChange: setViewMode,
    curveAxis,
    handleCurveAxisChange: setCurveAxis,
    curveGraph,
    handleCurveGraphChange,
    curveUnderlay,
    handleCurveUnderlayChange,
    poseCursorFollow,
    handlePoseCursorFollowChange,
    handleCreatePose,
    handleSaveShapeAtCursor,
    handleStaggerSegments,
    handleRetimeSegmentCurves,
    getTimelineObject,
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
  // 这条序列的动作正在运行时删不了：按下时提示，不弹确认（保存由 handleSave 提示）
  const runningActionIds = useRunningActionIds();
  const { selectedId, multiSelectedIds, select, toggleMulti, replaceSelection } = useSelection();
  // 没有「编辑动作序列」：时间轴只读，能播放、跳转、看曲线，不能拖、删、加标记、粘贴
  const canEdit = usePermissions().can("action.edit");

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
  // 轨道上点选块时物体选中跟着走（3D、左侧轨道、手动控制都对上），规则见 followedObjectIds
  const handleTimelineSelectionChange = (next: SequenceSelection, follow?: ObjectFollow) => {
    handleSelectionChange(next);
    if (!follow || !sequence) return;
    const current =
      multiSelectedIds.length > 0 ? multiSelectedIds : selectedId != null ? [selectedId] : [];
    const objectIds = followedObjectIds(sequence, next, follow, current);
    if (objectIds === null) return;
    handleObjectsFollow(objectIds);
    replaceSelection(objectIds);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [fitRequestId, setFitRequestId] = useState(0);
  const [revealCursorRequestId, setRevealCursorRequestId] = useState(0);
  const [renamingMarkerId, setRenamingMarkerId] = useState<string | null>(null);
  // 右键「统一时长…」「错峰…」要填的秒数
  const [secondsPrompt, setSecondsPrompt] = useState<SecondsPrompt | null>(null);
  // 右键「整体缩放…」
  const [scalePrompt, setScalePrompt] = useState<ScalePrompt | null>(null);
  const selectedBlockIds = selectionBlockIds(selection);
  const invalidTargets = useMemo(
    () => invalidTimelineTargets(sequenceIssues),
    [sequenceIssues],
  );

  // 引用的横条显示被引用序列现在的名字
  const sequenceNames = useMemo(
    () => new Map((sequences ?? []).map((item) => [item.id, item.name])),
    [sequences],
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

  // 在整条序列的关键帧之间跳，和选中的物体无关
  const keyframes = useMemo(
    () => (sequence ? keyframeTimesMs(sequence, totalMs) : []),
    [sequence, totalMs],
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
  // 播放中联机的影子不跟着游标走：把播放状态报给 context
  useEffect(() => {
    handleTimelinePlayingChange?.(isPlaying);
  }, [isPlaying, handleTimelinePlayingChange]);
  useEffect(() => () => handleTimelinePlayingChange?.(false), [handleTimelinePlayingChange]);

  // 选中位姿（同一时刻）时游标跳过去，3D 显示的就是正在改的那一帧；改了位姿的时刻也跟着走。
  // 只看选中和位姿时刻：播放、拖游标都不触发
  const followTimeMs = useMemo(() => selectedPosesTimeMs(sequence, selection), [sequence, selection]);
  useEffect(() => {
    if (!poseCursorFollow || isPlaying || followTimeMs === null) return;
    handleCursorChange(followTimeMs);
  }, [selection, followTimeMs]);

  // ＋位姿 / K：在游标处给选中的物体加位姿，不用先回到「添加位姿」
  const addPoseAtPlayhead = () => handleCreatePose?.([...multiSelectedIds]);

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
        if (!canEdit) return;
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
      if (!canEdit) return;
      if (plain && !event.shiftKey && (event.key.toLowerCase() === "m" || event.code === "KeyM")) {
        event.preventDefault();
        addMarkerAtPlayhead();
        return;
      }
      if (plain && !event.shiftKey && (event.key.toLowerCase() === "k" || event.code === "KeyK")) {
        event.preventDefault();
        addPoseAtPlayhead();
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
    canEdit,
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
    handleCreatePose,
    multiSelectedIds,
  ]);

  if (!sequence) return null;

  // 选中里有引用时右键可以展开成普通块；只选了一个引用时可以打开它引用的序列
  const selectedRefs = sequence.blocks.filter(
    (block): block is Extract<typeof block, { kind: "sequence-ref" }> =>
      block.kind === "sequence-ref" && selectedBlockIds.includes(block.id),
  );
  const openableRef =
    selectedRefs.length === 1 ? sequences.find((item) => item.id === selectedRefs[0]!.sequenceId) : undefined;
  const refActions: ContextMenuAction[] = [
    ...(canEdit && selectedRefs.length > 0
      ? [
          {
            label: selectedRefs.length > 1 ? `展开 ${selectedRefs.length} 个引用` : "展开引用（变成普通块）",
            onSelect: () => handleExplodeSequenceRefs(selectedRefs.map((block) => block.id)),
          },
        ]
      : []),
    ...(openableRef ? [{ label: `打开「${openableRef.name}」`, onSelect: () => handleSequenceSelect(openableRef.id) }] : []),
  ];

  // 选中里有预设时右键可以拆解成位姿
  const selectedPresetIds = sequence.blocks
    .filter(
      (block) =>
        (block.kind === "static-preset" || block.kind === "dynamic-preset") &&
        selectedBlockIds.includes(block.id),
    )
    .map((block) => block.id);
  const presetActions: ContextMenuAction[] = [
    ...(canEdit && selectedPresetIds.length > 0
      ? [
          {
            label:
              selectedPresetIds.length > 1 ? `拆解 ${selectedPresetIds.length} 个预设` : "拆解预设",
            onSelect: () => handleExplodePresets(selectedPresetIds),
          },
        ]
      : []),
    // 序列在游标那一刻的样子存成新的单帧序列（选中的物体，没选就是全部）
    ...(canEdit && handleSaveShapeAtCursor
      ? [{ label: "游标处存为造型", onSelect: () => handleSaveShapeAtCursor() }]
      : []),
  ];

  // 选中了两段以上运动区间（两端都选中）：右键里整体缩放、统一时长、错峰
  const selectedSegments = resolved ? selectedSegmentsOf(resolved, selectedBlockIds) : [];
  const selectionSpan = blocksSpanMs(sequence, selectedBlockIds);
  const segmentKeys = selectedSegments.map((segment) => segment.key);
  const onePerObject =
    new Set(selectedSegments.map((segment) => segment.objectId)).size === selectedSegments.length;
  const durations = selectedSegments.map((segment) => segment.durationMs);
  const sharedDurationMs = durations.every((ms) => ms === durations[0]) ? durations[0] : undefined;
  const segmentActions: ContextMenuAction[] =
    canEdit && selectedSegments.length >= 2
      ? [
          ...(selectionSpan && selectionSpan.endMs > selectionSpan.startMs
            ? [
                {
                  label: "整体缩放…",
                  onSelect: () =>
                    setScalePrompt({
                      durationMs: selectionSpan.endMs - selectionSpan.startMs,
                      segmentCount: selectedSegments.length,
                      onConfirm: (durationMs, shiftAll) =>
                        handleScaleTimelineBlocks({ blockIds: selectedBlockIds, durationMs, shiftAll }),
                    }),
                },
              ]
            : []),
          ...(handleRetimeSegmentCurves
            ? [
                {
                  label: "统一时长…",
                  onSelect: () =>
                    setSecondsPrompt({
                      title: "统一时长",
                      description: `选中的 ${selectedSegments.length} 段都改成这个时长，各物体后面的块跟着挪`,
                      label: "每段时长",
                      initialSeconds: (sharedDurationMs ?? Math.max(...durations)) / 1000,
                      min: 0.1,
                      onConfirm: (seconds) => {
                        const writes = uniformDurationWrites(selectedSegments, getTimelineObject, secondsToMs(seconds));
                        if (writes.length > 0) handleRetimeSegmentCurves(writes);
                      },
                    }),
                },
              ]
            : []),
          ...(handleStaggerSegments
            ? [
                {
                  label: onePerObject ? "错峰…" : "错峰…（每台只选一段）",
                  disabled: !onePerObject,
                  onSelect: () =>
                    setSecondsPrompt({
                      title: "错峰",
                      description: "到达不动，按出发先后，每台比上一台晚出发",
                      label: "每台比上一台晚",
                      initialSeconds: 1,
                      min: 0.1,
                      onConfirm: (seconds) => handleStaggerSegments(segmentKeys, secondsToMs(seconds)),
                    }),
                },
              ]
            : []),
        ]
      : [];

  // 游标在选中区间的中间：右键里在游标处插入变速点（切开这段，改后半段的速度就是加速、减速）
  const speedPointKeys = selectedSegments
    .filter((segment) => segment.startMs < cursorMs && cursorMs < segment.endMs)
    .map((segment) => segment.key);
  const speedPointActions: ContextMenuAction[] =
    canEdit && speedPointKeys.length > 0
      ? [
          {
            label:
              speedPointKeys.length > 1
                ? `在游标处插入变速点（${speedPointKeys.length} 段）`
                : "在游标处插入变速点",
            onSelect: () => handleInsertSpeedPoints(speedPointKeys),
          },
        ]
      : [];

  const timelineResolved = resolved ?? unresolvedSequenceStub(sequence);

  /**
   * 右键点在没选中的块上时先选中它，菜单里的“复制”作用于这个块；
   * 点在没选中的运动区间上时选中它两端（右键里插入变速点等作用于它）
   */
  const handleTimelineContextMenu = (event: MouseEvent<HTMLElement>) => {
    const element = event.target instanceof Element ? event.target : null;
    const target = element?.closest<HTMLElement>("[data-block-id]");
    const blockId = target?.dataset.blockId;
    if (blockId && !isBlockSelected(selection, blockId)) {
      handleTimelineSelectionChange({ kind: "block", blockId }, "replace");
      return;
    }
    const band = blockId ? null : element?.closest<HTMLElement>("[data-from-ref][data-to-ref]");
    if (!band || !resolved) return;
    const segment = resolved.segments.find(
      (item) => item.fromRef === band.dataset.fromRef && item.toRef === band.dataset.toRef,
    );
    if (!segment || selectedSegments.some((item) => item.key === segment.key)) return;
    handleTimelineSelectionChange(segmentSelection(resolved, segment), "replace");
  };

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
    >
      <TimelineToolbar
        readOnly={!canEdit}
        trajectoryMode={sequence.trajectoryMode}
        onTrajectoryModeChange={handleTrajectoryModeChange}
        loop={sequence.loop === true}
        canLoop={resolved !== null && sequencePathIsClosed(resolved)}
        loopDisabledHint={SEQUENCE_LOOP_DISABLED_HINT}
        onLoopChange={handleLoopChange}
        pxPerSecond={timelinePxPerSecond}
        onPxPerSecondChange={handleTimelinePxPerSecondChange}
        canDelete
        canPlay={canPlay}
        isPlaying={isPlaying}
        atEnd={totalMs > 0 && cursorMs >= totalMs}
        onPlayToggle={handlePlayToggle}
        onSave={handleSave}
        canSave={sequence !== null && draftSequenceIds.has(sequence.id)}
        onUndo={canEdit ? handleUndoEdit : undefined}
        onRedo={canEdit ? handleRedoEdit : undefined}
        canUndo={canUndoEdit}
        canRedo={canRedoEdit}
        onDelete={() =>
          sequence && runningActionIds.has(sequence.id)
            ? toast.warning(runningSequenceMessage([sequence.name], "删除"))
            : setDeleteOpen(true)
        }
        onZoomFit={handleZoomFit}
        onPrevKeyframe={() => jumpTo(prevKeyframe)}
        onNextKeyframe={() => jumpTo(nextKeyframe)}
        canPrevKeyframe={prevKeyframe !== null}
        canNextKeyframe={nextKeyframe !== null}
        snapEnabled={snapEnabled}
        onSnapToggle={handleSnapToggle}
        markers={markers}
        onAddMarker={canEdit ? addMarkerAtPlayhead : undefined}
        onAddPose={canEdit ? addPoseAtPlayhead : undefined}
        onJumpToMarker={jumpToMarker}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        curveGraph={curveGraph}
        onCurveGraphChange={handleCurveGraphChange}
        curveUnderlay={curveUnderlay}
        onCurveUnderlayChange={handleCurveUnderlayChange}
        poseCursorFollow={poseCursorFollow}
        onPoseCursorFollowChange={handlePoseCursorFollowChange}
        curveAxis={shownCurveAxis}
        curveAxes={curveAxes}
        onCurveAxisChange={setCurveAxis}
      />
      <SequenceDeleteDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
      <MarkerRenameDialog marker={renamingMarker} onClose={() => setRenamingMarkerId(null)} />
      <SecondsPromptDialog prompt={secondsPrompt} onClose={() => setSecondsPrompt(null)} />
      <ScalePromptDialog prompt={scalePrompt} onClose={() => setScalePrompt(null)} />
      {resolved === null && (
        <div className="shrink-0 bg-warning-surface px-3 py-2 text-body-sm text-warning">
          预设无法解析，可继续编辑块
        </div>
      )}
      <ClipboardContextMenu
        copyLabel="复制动作块"
        pasteLabel="粘贴到播放头"
        canCopy={selectedBlockIds.length > 0}
        canPaste={canEdit && canPasteBlock}
        onCopy={handleBlockCopy}
        onPaste={handleBlockPaste}
        onContextMenu={handleTimelineContextMenu}
        actions={[...speedPointActions, ...segmentActions, ...refActions, ...presetActions]}
      >
        <div data-guide="console-action-timeline" className="flex min-h-0 flex-1">
          <TimelineEditor
            sequence={sequence}
            resolved={timelineResolved}
            objects={timelineObjects}
            selection={selection}
            cursorMs={cursorMs}
            isPlaying={isPlaying}
            timelinePxPerSecond={timelinePxPerSecond}
            onSelectionChange={handleTimelineSelectionChange}
            onCursorChange={handleCursorChange}
            onPoseMove={canEdit ? handleMoveTimelineBlock : ignoreEdit}
            onPresetMove={canEdit ? handleMoveTimelineBlock : ignoreEdit}
            onBlocksShift={canEdit ? handleShiftTimelineBlocks : undefined}
            onBlocksShiftEnd={canEdit ? handleShiftTimelineBlocksEnd : undefined}
            onDynamicPresetResize={canEdit ? handleResizeDynamicPreset : ignoreEdit}
            onTimelinePxPerSecondChange={handleTimelinePxPerSecondChange}
            invalidTargets={invalidTargets}
            selectedObjectIds={multiSelectedIds}
            onObjectClick={handleObjectClick}
            onCreatePoseAt={
              canEdit && handleCreatePose ? (objectId, atMs) => handleCreatePose([objectId], atMs) : undefined
            }
            snapEnabled={snapEnabled}
            fitRequestId={fitRequestId}
            revealCursorRequestId={revealCursorRequestId + (cursorRevealRequestId ?? 0)}
            onMarkersShift={canEdit ? handleShiftMarkers : undefined}
            onMarkersShiftEnd={canEdit ? handleShiftMarkersEnd : undefined}
            onMarkerRename={canEdit ? (marker) => setRenamingMarkerId(marker.id) : undefined}
            viewMode={viewMode}
            curveAxis={shownCurveAxis}
            curveGraph={curveGraph}
            curveUnderlay={curveUnderlay}
            onPoseAxisDrag={canEdit ? handleDragPoseAxis : undefined}
            onPoseAxisDragEnd={canEdit ? handleDragPoseAxisEnd : undefined}
            onScaleSelection={
              canEdit && handleScaleTimelineBlocks
                ? (blockIds, durationMs) => handleScaleTimelineBlocks({ blockIds, durationMs }, true)
                : undefined
            }
            onScaleSelectionEnd={handleScaleTimelineBlocksEnd}
            sequenceNames={sequenceNames}
            onOpenSequence={handleSequenceSelect}
            onDropSequence={canEdit ? (sequenceId, atMs) => handleInsertSequenceRef(sequenceId, atMs) : undefined}
          />
        </div>
      </ClipboardContextMenu>
    </div>
  );
};

/** 只读时间轴：拖动不改序列（块位置来自序列，保持不动） */
const ignoreEdit = () => {};

/**
 * 编辑坞：随动作序列库选中项变形 — 动作 → 时间轴。
 */
export const EditorDock = ({ className }: { className?: string }) => {
  const { dockMode } = useActionBuilder();

  return (
    <div
      data-guide="console-action-editor"
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
