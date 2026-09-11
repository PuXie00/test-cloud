import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { cn } from "@/app/components/ui/utils";
import { getMotionItemRepairIssue } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { useConsoleMode } from "../../hooks/use-console-mode";
import type { ChapterItem } from "./program-data";
import { ChapterItemRow } from "./chapter-item-row";

type PageSectionProps = {
  chapterId: string;
  pageIndex: number;
  pageTotal: number;
  isCurrent: boolean;
  sequences: ChapterItem[];
  onClickHeader: () => void;
  onAddSequence: () => void;
  onItemDragStart: (
    chapterId: string,
    item: ChapterItem,
    index: number
  ) => (event: React.DragEvent) => void;
  onDoubleClickItem?: (item: ChapterItem) => void;
  itemIndexOffset: number;
};

export const PageSection = ({
  chapterId,
  pageIndex,
  pageTotal,
  isCurrent,
  sequences,
  onClickHeader,
  onAddSequence,
  onItemDragStart,
  onDoubleClickItem,
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
      <button
        type="button"
        onClick={() => {
          onClickHeader();
          setExpanded(true);
        }}
        className={cn(
          "flex h-8 items-center gap-2 border-l-2 px-3 text-left transition-colors",
          isCurrent
            ? "border-l-primary bg-primary/10 text-primary"
            : "border-l-transparent text-muted-foreground hover:bg-muted/30"
        )}
      >
        <span onClick={handleToggle} className="flex h-4 w-4 items-center justify-center">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
        <span className="text-label-caps">
          页 {pageIndex + 1}/{pageTotal}
          {isCurrent && " · 当前页"}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col">
          {sequences.map((item, idx) => {
            const issue = resolveItemWarning(item);
            return (
              <ChapterItemRow
                key={item.sequence.id}
                item={item}
                slotLabel={`F${idx + 1}`}
                hasWarning={Boolean(issue)}
                warningMessage={issue?.message}
                draggable={mode === "rehearsal"}
                onDragStart={onItemDragStart(chapterId, item, itemIndexOffset + idx)}
                onDoubleClick={() => onDoubleClickItem?.(item)}
              />
            );
          })}
          {mode === "rehearsal" && (
            <div className="flex gap-1 px-2 py-2">
              <button
                type="button"
                onClick={onAddSequence}
                className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-sm border border-dashed border-border text-body-sm text-muted-foreground hover:bg-muted/30"
              >
                <Plus className="h-3 w-3" /> 序列
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
