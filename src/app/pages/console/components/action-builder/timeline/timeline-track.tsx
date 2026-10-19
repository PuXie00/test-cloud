import { presetLabelOf } from "@/app/project/action-sequence/preset-registry";
import type {
  DynamicPresetBlock,
  InstructionBlock,
  KeyframePose,
  StaticPresetBlock,
} from "@/app/project/action-sequence/types";
import type { ResolvedMotionSegment, ResolvedPosePoint } from "@/app/project/action-sequence/resolve-sequence";
import type { InvalidTimelineTargets } from "@/app/project/action-sequence/validate-sequence";
import { isBlockSelected, type SequenceSelection } from "../sequence-selection";
import { CommandEventMarker } from "./command-event-marker";
import { PoseMarker } from "./pose-marker";
import { PresetProjection } from "./preset-projection";
import { SegmentBand } from "./segment-band";

export type TimelineTrackPose = {
  id: string;
  atMs: number;
  pose: KeyframePose;
  label?: string;
  isInitialPose: boolean;
  /** 有轴不设定（这一帧经过） */
  partial?: boolean;
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
  /** 两端都选中的运动区间 */
  selectedSegmentKeys: ReadonlySet<string>;
  viewStartMs: number;
  contentWidth: number;
  pxPerSecond: number;
  /** additive：Ctrl/⌘ 单击加选或减选 */
  onBlockSelect: (blockId: string, additive: boolean) => void;
  onSegmentSelect: (segment: ResolvedMotionSegment, additive: boolean) => void;
  /** 拖运动区间：startMs 是区间起点想去的时刻 */
  onSegmentMove?: (segment: ResolvedMotionSegment, startMs: number) => void;
  onPoseMove: (blockId: string, atMs: number) => void;
  onPresetMove: (blockId: string, atMs: number) => void;
  onDynamicPresetResize: (
    blockId: string,
    startMs: number,
    endMs: number,
    edge?: "start" | "end",
  ) => void;
  onBlockMoveEnd?: () => void;
  invalidTargets?: InvalidTimelineTargets;
};

const presetLabel = (block: StaticPresetBlock | DynamicPresetBlock): string =>
  block.label ?? presetLabelOf(block.presetId);

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
  selectedSegmentKeys,
  viewStartMs,
  contentWidth,
  pxPerSecond,
  onBlockSelect,
  onSegmentSelect,
  onSegmentMove,
  onPoseMove,
  onPresetMove,
  onDynamicPresetResize,
  onBlockMoveEnd,
  invalidTargets,
}: TimelineTrackProps) => (
    <div
      data-track-object-id={String(objectId)}
      className="relative h-9 shrink-0"
      style={{ width: contentWidth }}
      title={objectName}
    >
      {segments.map((segment) => (
        <SegmentBand
          key={segment.key}
          objectId={segment.objectId}
          fromRef={segment.fromRef}
          toRef={segment.toRef}
          startMs={segment.startMs}
          endMs={segment.endMs}
          selected={selectedSegmentKeys.has(segment.key)}
          invalid={invalidTargets?.segmentKeys.has(segment.key) ?? false}
          invalidMessage={invalidTargets?.segmentMessage.get(segment.key)}
          viewStartMs={viewStartMs}
          pxPerSecond={pxPerSecond}
          onSelect={(additive) => onSegmentSelect(segment, additive)}
          onMove={onSegmentMove ? (startMs) => onSegmentMove(segment, startMs) : undefined}
          onMoveEnd={onBlockMoveEnd}
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
          onSelect={(additive) => onBlockSelect(block.id, additive)}
          onMove={(nextAtMs) => onPresetMove(block.id, nextAtMs)}
          onMoveEnd={onBlockMoveEnd}
          onResize={(nextStart, nextEnd, edge) =>
            onDynamicPresetResize(block.id, nextStart, nextEnd, edge)
          }
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
          onSelect={(additive) => onBlockSelect(block.id, additive)}
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
          partial={pose.partial}
          selected={isBlockSelected(selection, pose.id)}
          invalid={invalidTargets?.blockIds.has(pose.id) ?? false}
          invalidMessage={invalidTargets?.blockMessage.get(pose.id)}
          viewStartMs={viewStartMs}
          pxPerSecond={pxPerSecond}
          onSelect={(additive) => onBlockSelect(pose.id, additive)}
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
          onSelect={(additive) => onBlockSelect(command.id, additive)}
        />
      ))}
    </div>
);
