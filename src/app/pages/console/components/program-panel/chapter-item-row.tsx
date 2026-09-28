import type { ChapterItem } from "./program-data";
import { ProgramSequenceRow } from "./program-sequence-row";
import { isForcedTrajectory } from "../forced-trajectory-badge";

type ChapterItemRowProps = {
  item: ChapterItem;
  isActive?: boolean;
  hasWarning?: boolean;
  warningMessage?: string;
  draggable?: boolean;
  striped?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onPreviewHoldStart?: () => void;
  onPreviewHoldEnd?: () => void;
  onDragStart?: (event: React.DragEvent) => void;
};

export const ChapterItemRow = ({
  item,
  isActive,
  hasWarning,
  warningMessage,
  draggable = true,
  striped = false,
  onClick,
  onDoubleClick,
  onPreviewHoldStart,
  onPreviewHoldEnd,
  onDragStart,
}: ChapterItemRowProps) => {
  const name = item.sequence.name;
  const durationMs = item.sequence.durationMs;
  const repairMessage = warningMessage ?? (hasWarning ? "待修复" : null);

  return (
    <ProgramSequenceRow
      role="treeitem"
      name={name}
      durationLabel={(durationMs / 1000).toFixed(1)}
      repairMessage={repairMessage}
      forced={isForcedTrajectory(item.sequence.trajectoryMode)}
      draggable={draggable}
      striped={striped}
      ariaSelected={isActive}
      onDragStart={onDragStart}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPreviewHoldStart={onPreviewHoldStart}
      onPreviewHoldEnd={onPreviewHoldEnd}
    />
  );
};
