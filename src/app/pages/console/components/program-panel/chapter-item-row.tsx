import type { ChapterItem } from "./program-data";
import { ProgramSequenceRow } from "./program-sequence-row";

type ChapterItemRowProps = {
  item: ChapterItem;
  slotLabel: string;
  isActive?: boolean;
  hasWarning?: boolean;
  warningMessage?: string;
  draggable?: boolean;
  striped?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onDragStart?: (event: React.DragEvent) => void;
};

export const ChapterItemRow = ({
  item,
  slotLabel,
  isActive,
  hasWarning,
  warningMessage,
  draggable = true,
  striped = false,
  onClick,
  onDoubleClick,
  onDragStart,
}: ChapterItemRowProps) => {
  const name = item.sequence.name;
  const durationMs = item.sequence.durationMs;
  const repairMessage = warningMessage ?? (hasWarning ? "待修复" : null);

  return (
    <ProgramSequenceRow
      role="treeitem"
      name={name}
      indexLabel={slotLabel}
      durationLabel={(durationMs / 1000).toFixed(1)}
      repairMessage={repairMessage}
      draggable={draggable}
      striped={striped}
      ariaSelected={isActive}
      onDragStart={onDragStart}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    />
  );
};
