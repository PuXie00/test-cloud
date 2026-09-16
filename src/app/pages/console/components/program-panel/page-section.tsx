import { useState } from "react";
import { getMotionItemRepairIssue } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { useConsoleMode } from "../../hooks/use-console-mode";
import type { ChapterItem } from "./program-data";
import { ChapterItemRow } from "./chapter-item-row";
import { ProgramPageHeader } from "./program-page-header";

type PageSectionProps = {
  chapterId: string;
  pageIndex: number;
  pageTotal: number;
  isCurrent: boolean;
  sequences: ChapterItem[];
  onClickHeader: () => void;
  onItemDragStart: (
    chapterId: string,
    item: ChapterItem,
    index: number,
  ) => (event: React.DragEvent) => void;
  onDoubleClickItem?: (item: ChapterItem) => void;
  onClickItem?: (item: ChapterItem) => void;
  activeSequenceId?: number | null;
  itemIndexOffset: number;
};

export const PageSection = ({
  chapterId,
  pageIndex,
  pageTotal,
  isCurrent,
  sequences,
  onClickHeader,
  onItemDragStart,
  onDoubleClickItem,
  onClickItem,
  activeSequenceId,
  itemIndexOffset,
}: PageSectionProps) => {
  const { mode } = useConsoleMode();
  const { currentProject } = useProject();
  const document = currentProject?.document;
  const [expanded, setExpanded] = useState(isCurrent);

  const handleToggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    setExpanded((current) => !current);
  };

  const resolveItemWarning = (item: ChapterItem) => {
    if (!document) return null;
    return getMotionItemRepairIssue(document, "sequence", item.sequence.id);
  };

  return (
    <div className="flex flex-col">
      <ProgramPageHeader
        pageIndex={pageIndex}
        pageTotal={pageTotal}
        isCurrent={isCurrent}
        expanded={expanded}
        onToggle={handleToggle}
        onSelect={() => {
          onClickHeader();
          setExpanded(true);
        }}
      />

      {expanded && (
        <div className="flex flex-col">
          {sequences.map((item, idx) => {
            const issue = resolveItemWarning(item);
            return (
              <ChapterItemRow
                key={item.sequence.id}
                item={item}
                slotLabel={`F${idx + 1}`}
                isActive={item.sequence.id === activeSequenceId}
                hasWarning={Boolean(issue)}
                warningMessage={issue?.message}
                draggable={mode === "rehearsal"}
                striped={idx % 2 !== 0}
                onDragStart={onItemDragStart(chapterId, item, itemIndexOffset + idx)}
                onClick={() => onClickItem?.(item)}
                onDoubleClick={() => onDoubleClickItem?.(item)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
