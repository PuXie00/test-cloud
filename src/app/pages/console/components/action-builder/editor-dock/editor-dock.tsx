import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { MousePointerClick } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import {
  resolveActionSequence,
  type ResolvedActionSequence,
} from "@/app/project/action-sequence/resolve-sequence";
import { sequencePathIsClosed, SEQUENCE_LOOP_DISABLED_HINT } from "@/app/project/action-sequence/sequence-loop";
import { invalidTimelineTargets } from "@/app/project/action-sequence/validate-sequence";
import { useActionBuilder } from "../use-action-builder";
import { selectionBlockIds } from "../sequence-selection";
import {
  TIMELINE_PX_PER_SECOND_MAX,
  TIMELINE_PX_PER_SECOND_MIN,
} from "../timeline/timeline-data";
import { pickNiceMajorStepSec } from "../timeline/timeline-ticks";
import { TimelineEditor } from "../timeline/timeline-editor";
import { TimelineToolbar } from "../timeline/timeline-toolbar";

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
    handleMoveTimelineBlock,
    handleShiftTimelineBlocks,
    handleShiftTimelineBlocksEnd,
    handleResizeDynamicPreset,
    handleBlockDelete,
    handleDeleteSequence,
    handleBlockCopy,
    handleBlockPaste,
    handleTimelinePxPerSecondChange,
    handleTimelineZoomIn,
    handleTimelineZoomOut,
    handleSave,
    handleTrajectoryModeChange,
    handleLoopChange,
    sequenceIssues,
  } = useActionBuilder();
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedBlockIds = selectionBlockIds(selection);
  const overspeedIssues = (sequenceIssues ?? []).filter((issue) => issue.code === "motor-overspeed");
  const invalidTargets = useMemo(
    () => invalidTimelineTargets(sequenceIssues),
    [sequenceIssues],
  );

  const majorStepSec = useMemo(
    () => pickNiceMajorStepSec(timelinePxPerSecond),
    [timelinePxPerSecond],
  );

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedBlockIds.length === 0) return;
      event.preventDefault();
      handleBlockDelete();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [handleBlockDelete, selectedBlockIds.length]);

  const resolved = useMemo(() => {
    if (!sequence) return null;
    try {
      return resolveActionSequence(sequence);
    } catch {
      return null;
    }
  }, [sequence]);

  if (!sequence) return null;

  const timelineResolved = resolved ?? unresolvedSequenceStub(sequence);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "c") {
      event.preventDefault();
      handleBlockCopy();
      return;
    }
    if (mod && event.key.toLowerCase() === "v") {
      event.preventDefault();
      handleBlockPaste();
    }
  };

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
    >
      <TimelineToolbar
        sequenceName={sequence.name}
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
        onSave={handleSave}
        onDelete={handleDeleteSequence}
        onZoomIn={handleTimelineZoomIn}
        onZoomOut={handleTimelineZoomOut}
      />
      {resolved === null && (
        <div className="shrink-0 bg-warning-surface px-3 py-2 text-body-sm text-warning">
          预设无法解析，可继续编辑块
        </div>
      )}
      {overspeedIssues.length > 0 && (
        <div
          role="alert"
          className="shrink-0 bg-warning-surface px-3 py-2 text-body-sm text-warning"
        >
          {overspeedIssues[0]?.message}
          {overspeedIssues.length > 1
            ? ` 等 ${overspeedIssues.length} 处吊点电机超速`
            : null}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <TimelineEditor
          sequence={sequence}
          resolved={timelineResolved}
          objects={timelineObjects}
          selection={selection}
          cursorMs={cursorMs}
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
        />
      </div>
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
