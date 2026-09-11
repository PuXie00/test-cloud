import type { DragEvent } from "react";
import type {
  DynamicPresetBlock,
  InstructionBlock,
  ModelPose,
  StaticPresetBlock,
} from "@/app/project/action-sequence/types";
import type { ResolvedMotionSegment, ResolvedPosePoint } from "@/app/project/action-sequence/resolve-sequence";
import type { InvalidTimelineTargets } from "@/app/project/action-sequence/validate-sequence";
import { isBlockSelected, type SequenceSelection } from "../sequence-selection";
import { cueIdFromLibraryDrag, isLibraryDrag } from "../content-library/library-dnd";
import { CommandEventMarker } from "./command-event-marker";
import { PoseMarker } from "./pose-marker";
import { PresetProjection } from "./preset-projection";
import { SegmentBand } from "./segment-band";
import { pxToMs } from "./timeline-data";
import { clampCursorMs } from "./timeline-view-extent";

export type TimelineTrackPose = {
  id: string;
  atMs: number;
  pose: ModelPose;
  label?: string;
  isInitialPose: boolean;
};

export type TimelineTrackProps = {
  objectId: number;
  objectName: string;
  poses: TimelineTrackPose[];
  commands: InstructionBlock[];
  staticPresets: StaticPresetBlock[];
  dynamicPresets: DynamicPresetBlock[];
  resolvedInitialPose?: ResolvedPosePoint;
  generatedTicksByPreset: Record<string, number[]>;
  segments: ResolvedMotionSegment[];
  selection: SequenceSelection;
  viewStartMs: number;
  contentWidth: number;
  pxPerSecond: number;
  onSelectionChange: (selection: SequenceSelection) => void;
  onPoseMove: (blockId: string, atMs: number) => void;
  onPresetMove: (blockId: string, atMs: number) => void;
  onDynamicPresetResize: (blockId: string, startMs: number, endMs: number) => void;
  onBlockMoveEnd?: () => void;
  onCueDrop?: (objectId: number, cueId: string, atMs: number) => void;
  invalidTargets?: InvalidTimelineTargets;
};

const isSegmentSelected = (
  selection: SequenceSelection,
  segment: ResolvedMotionSegment,
): boolean =>
  selection?.kind === "segment" &&
  selection.objectId === segment.objectId &&
  selection.fromRef === segment.fromRef &&
  selection.toRef === segment.toRef;

const presetLabel = (block: StaticPresetBlock | DynamicPresetBlock): string =>
  block.label ?? block.presetId;

const presetInitialPoseAtMs = (
  initial: ResolvedPosePoint | undefined,
  blockId: string,
): number | undefined => (initial?.sourceBlockId === blockId ? initial.atMs : undefined);

export const TimelineTrack = ({
  objectId,
  objectName,
  poses,
  commands,
  staticPresets,
  dynamicPresets,
  resolvedInitialPose,
  generatedTicksByPreset,
  segments,
  selection,
  viewStartMs,
  contentWidth,
  pxPerSecond,
  onSelectionChange,
  onPoseMove,
  onPresetMove,
  onDynamicPresetResize,
  onBlockMoveEnd,
  onCueDrop,
  invalidTargets,
}: TimelineTrackProps) => {
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!isLibraryDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const cueId = cueIdFromLibraryDrag(event.dataTransfer);
    if (!cueId || !onCueDrop) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = Number.isFinite(event.clientX) ? event.clientX : 0;
    const atMs = clampCursorMs(viewStartMs + pxToMs(pointerX - rect.left, pxPerSecond));
    onCueDrop(objectId, cueId, atMs);
  };

  return (
    <div
      data-track-object-id={String(objectId)}
      className="relative h-9 shrink-0"
      style={{ width: contentWidth }}
      title={objectName}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {segments.map((segment) => (
        <SegmentBand
          key={segment.key}
          objectId={segment.objectId}
          fromRef={segment.fromRef}
          toRef={segment.toRef}
          startMs={segment.startMs}
          endMs={segment.endMs}
          selected={isSegmentSelected(selection, segment)}
          invalid={invalidTargets?.segmentKeys.has(segment.key) ?? false}
          invalidMessage={invalidTargets?.segmentMessage.get(segment.key)}
          viewStartMs={viewStartMs}
          pxPerSecond={pxPerSecond}
          onSelect={() =>
            onSelectionChange({
              kind: "segment",
              objectId: segment.objectId,
              fromRef: segment.fromRef,
              toRef: segment.toRef,
            })
          }
        />
      ))}
      {dynamicPresets.map((block) => (
        <PresetProjection
          key={block.id}
          blockId={block.id}
          kind="dynamic-preset"
          label={presetLabel(block)}
          startMs={block.startMs}
          endMs={block.endMs}
          generatedAtMs={generatedTicksByPreset[block.id] ?? []}
          initialPoseAtMs={presetInitialPoseAtMs(resolvedInitialPose, block.id)}
          selected={isBlockSelected(selection, block.id)}
          invalid={invalidTargets?.blockIds.has(block.id) ?? false}
          invalidMessage={invalidTargets?.blockMessage.get(block.id)}
          viewStartMs={viewStartMs}
          pxPerSecond={pxPerSecond}
          onSelect={() => onSelectionChange({ kind: "block", blockId: block.id })}
          onMove={(nextAtMs) => onPresetMove(block.id, nextAtMs)}
          onMoveEnd={onBlockMoveEnd}
          onResize={(nextStart, nextEnd) => onDynamicPresetResize(block.id, nextStart, nextEnd)}
        />
      ))}
      {staticPresets.map((block) => (
        <PresetProjection
          key={block.id}
          blockId={block.id}
          kind="static-preset"
          label={presetLabel(block)}
          atMs={block.atMs}
          initialPoseAtMs={presetInitialPoseAtMs(resolvedInitialPose, block.id)}
          selected={isBlockSelected(selection, block.id)}
          invalid={invalidTargets?.blockIds.has(block.id) ?? false}
          invalidMessage={invalidTargets?.blockMessage.get(block.id)}
          viewStartMs={viewStartMs}
          pxPerSecond={pxPerSecond}
          onSelect={() => onSelectionChange({ kind: "block", blockId: block.id })}
          onMove={(nextAtMs) => onPresetMove(block.id, nextAtMs)}
          onMoveEnd={onBlockMoveEnd}
        />
      ))}
      {poses.map((pose) => (
        <PoseMarker
          key={pose.id}
          blockId={pose.id}
          atMs={pose.atMs}
          label={pose.label}
          isInitialPose={pose.isInitialPose}
          selected={isBlockSelected(selection, pose.id)}
          invalid={invalidTargets?.blockIds.has(pose.id) ?? false}
          invalidMessage={invalidTargets?.blockMessage.get(pose.id)}
          viewStartMs={viewStartMs}
          pxPerSecond={pxPerSecond}
          onSelect={() => onSelectionChange({ kind: "block", blockId: pose.id })}
          onMove={(nextAtMs) => onPoseMove(pose.id, nextAtMs)}
          onMoveEnd={onBlockMoveEnd}
        />
      ))}
      {commands.map((command) => (
        <CommandEventMarker
          key={command.id}
          blockId={command.id}
          atMs={command.atMs}
          enabled={command.instr.enabled}
          selected={isBlockSelected(selection, command.id)}
          invalid={invalidTargets?.blockIds.has(command.id) ?? false}
          invalidMessage={invalidTargets?.blockMessage.get(command.id)}
          viewStartMs={viewStartMs}
          pxPerSecond={pxPerSecond}
          onSelect={() => onSelectionChange({ kind: "block", blockId: command.id })}
        />
      ))}
    </div>
  );
};
