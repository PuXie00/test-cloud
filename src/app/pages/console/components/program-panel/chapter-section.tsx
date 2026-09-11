import { ChevronDown, ChevronRight, MoreVertical } from "lucide-react";
import { useState } from "react";
import { cn } from "@/app/components/ui/utils";
import { useConsoleMode } from "../../hooks/use-console-mode";
import { PROGRAM_SLOTS_PER_PAGE, type Chapter, type ChapterItem } from "./program-data";
import { programPageCount, sliceProgramPage } from "./program-utils";
import { PageSection } from "./page-section";

type ChapterSectionProps = {
  chapter: Chapter;
  isCurrent: boolean;
  currentPageIndex: number;
  onSelectChapter: () => void;
  onSelectPage: (pageIndex: number) => void;
  onAddSequence: () => void;
  onItemDragStart: (
    chapterId: string,
    item: ChapterItem,
    index: number
  ) => (event: React.DragEvent) => void;
  onDoubleClickItem?: (item: ChapterItem) => void;
};

export const ChapterSection = ({
  chapter,
  isCurrent,
  currentPageIndex,
  onSelectChapter,
  onSelectPage,
  onAddSequence,
  onItemDragStart,
  onDoubleClickItem,
}: ChapterSectionProps) => {
  const { mode } = useConsoleMode();
  const [expanded, setExpanded] = useState(isCurrent);
  const pages = Array.from({ length: programPageCount(chapter.items) }, (_, pageIndex) =>
    sliceProgramPage(chapter.items, pageIndex),
  );

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => {
          onSelectChapter();
          setExpanded(true);
        }}
        className={cn(
          "flex h-10 items-center gap-2 border-l-2 px-3 text-left transition-colors",
          isCurrent
            ? "border-l-primary bg-muted text-foreground"
            : "border-l-transparent text-foreground/80 hover:bg-muted/30"
        )}
      >
        <span
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((current) => !current);
          }}
          className="flex h-4 w-4 items-center justify-center"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
        <span className="flex-1 truncate text-body-md font-medium">{chapter.name}</span>
        {isCurrent && (
          <span className="shrink-0 rounded-sm bg-primary/20 px-1.5 py-0.5 text-label-caps text-primary">
            当前
          </span>
        )}
        <span className="shrink-0 font-mono text-mono-sm text-muted-foreground">
          {pages.length}页·{chapter.items.length}项
        </span>
      </button>

      {expanded && chapter.note && (
        <p className="mx-3 my-2 rounded-sm bg-muted/30 px-2 py-1 text-body-sm text-muted-foreground">
          {chapter.note}
        </p>
      )}

      {expanded && (
        <div className="flex flex-col">
          {pages.map((sequences, pageIndex) => (
            <PageSection
              key={pageIndex}
              chapterId={chapter.id}
              pageIndex={pageIndex}
              pageTotal={pages.length}
              isCurrent={isCurrent && currentPageIndex === pageIndex}
              sequences={sequences}
              onClickHeader={() => onSelectPage(pageIndex)}
              onAddSequence={onAddSequence}
              onItemDragStart={onItemDragStart}
              onDoubleClickItem={onDoubleClickItem}
              itemIndexOffset={pageIndex * PROGRAM_SLOTS_PER_PAGE}
            />
          ))}
        </div>
      )}
    </div>
  );
};
