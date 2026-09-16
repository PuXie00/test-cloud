import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/app/components/ui/utils";
import { PROGRAM_SLOTS_PER_PAGE, type Chapter, type ChapterItem } from "./program-data";
import { programPageCount, sliceProgramPage } from "./program-utils";
import { PageSection } from "./page-section";

type ChapterSectionProps = {
  chapter: Chapter;
  isCurrent: boolean;
  currentPageIndex: number;
  onSelectChapter: () => void;
  onSelectPage: (pageIndex: number) => void;
  onItemDragStart: (
    chapterId: string,
    item: ChapterItem,
    index: number,
  ) => (event: React.DragEvent) => void;
  onDoubleClickItem?: (item: ChapterItem) => void;
  onClickItem?: (item: ChapterItem) => void;
  activeSequenceId?: number | null;
};

export const ChapterSection = ({
  chapter,
  isCurrent,
  currentPageIndex,
  onSelectChapter,
  onSelectPage,
  onItemDragStart,
  onDoubleClickItem,
  onClickItem,
  activeSequenceId,
}: ChapterSectionProps) => {
  const [expanded, setExpanded] = useState(isCurrent);
  const totalPages = programPageCount(chapter.items);
  const pages = Array.from({ length: totalPages }, (_, pageIndex) =>
    sliceProgramPage(chapter.items, pageIndex),
  );

  return (
    <div className="mb-1 rounded-md bg-muted/60">
      <button
        type="button"
        onClick={() => {
          onSelectChapter();
          setExpanded(true);
        }}
        className={cn(
          "flex h-9 w-full items-center gap-1.5 px-2 text-left transition-colors hover:bg-muted",
          isCurrent ? "bg-muted text-foreground" : "text-foreground/80",
        )}
      >
        <span
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((current) => !current);
          }}
          className="flex h-4 w-4 items-center justify-center"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-body-md font-medium">{chapter.name}</span>
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
        <p className="mx-2 my-2 rounded-sm bg-muted/30 px-2 py-1 text-body-sm text-muted-foreground">
          {chapter.note}
        </p>
      )}

      {expanded && (
        <div className="flex flex-col pb-1">
          {pages.map((sequences, pageIndex) => (
            <PageSection
              key={pageIndex}
              chapterId={chapter.id}
              pageIndex={pageIndex}
              pageTotal={pages.length}
              isCurrent={isCurrent && currentPageIndex === pageIndex}
              sequences={sequences}
              onClickHeader={() => onSelectPage(pageIndex)}
              onItemDragStart={onItemDragStart}
              onDoubleClickItem={onDoubleClickItem}
              onClickItem={onClickItem}
              activeSequenceId={activeSequenceId}
              itemIndexOffset={pageIndex * PROGRAM_SLOTS_PER_PAGE}
            />
          ))}
        </div>
      )}
    </div>
  );
};
