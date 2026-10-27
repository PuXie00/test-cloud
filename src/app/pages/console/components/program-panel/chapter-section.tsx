import { ChevronDown, ChevronRight } from "lucide-react";
import { usePermissions } from "@/app/auth/permissions";
import { useState } from "react";
import { cn } from "@/app/components/ui/utils";
import { PROGRAM_SLOTS_PER_PAGE, type Chapter, type ChapterItem } from "./program-data";
import { programPageCount, sliceProgramPage } from "./program-utils";
import { PageSection } from "./page-section";

type ChapterSectionProps = {
  chapter: Chapter;
  /** 已加载的章节：推子槽里是它的内容 */
  isCurrent: boolean;
  currentPageIndex: number;
  /** 点「加载」才选中章节；点章节名只展开 / 收起 */
  onLoadChapter: () => void;
  onSelectPage: (pageIndex: number) => void;
  onItemDragStart: (
    chapterId: string,
    item: ChapterItem,
    index: number,
  ) => (event: React.DragEvent) => void;
  onDoubleClickItem?: (item: ChapterItem) => void;
  onClickItem?: (item: ChapterItem) => void;
  onPreviewHoldStart?: (item: ChapterItem) => void;
  onPreviewHoldEnd?: () => void;
  activeSequenceId?: number | null;
};

export const ChapterSection = ({
  chapter,
  isCurrent,
  currentPageIndex,
  onLoadChapter,
  onSelectPage,
  onItemDragStart,
  onDoubleClickItem,
  onClickItem,
  onPreviewHoldStart,
  onPreviewHoldEnd,
  activeSequenceId,
}: ChapterSectionProps) => {
  const [expanded, setExpanded] = useState(isCurrent);
  // 加载章节会换掉推子上的序列，属于「运行动作」
  const canLoad = usePermissions().can("control.run");
  const totalPages = programPageCount(chapter.items);
  const pages = Array.from({ length: totalPages }, (_, pageIndex) =>
    sliceProgramPage(chapter.items, pageIndex),
  );

  return (
    <div className="mb-1 rounded-md bg-muted/60">
      <div
        className={cn(
          "flex h-9 w-full items-center gap-1.5 pr-2 transition-colors hover:bg-muted",
          isCurrent ? "bg-muted text-foreground" : "text-foreground/80",
        )}
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 text-left"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-body-md font-medium">{chapter.name}</span>
        </button>
        {isCurrent ? (
          <span className="shrink-0 rounded-sm bg-primary/20 px-1.5 py-0.5 text-label-caps text-primary">
            当前
          </span>
        ) : !canLoad ? null : (
          <button
            type="button"
            aria-label={`加载章节 ${chapter.name}`}
            onClick={() => {
              onLoadChapter();
              setExpanded(true);
            }}
            className="shrink-0 rounded-sm border border-primary/60 px-1.5 py-0.5 text-label-caps text-primary transition-colors hover:bg-primary/10"
          >
            加载
          </button>
        )}
        <span className="shrink-0 font-mono text-mono-sm text-muted-foreground">
          {pages.length}页·{chapter.items.length}项
        </span>
      </div>

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
              // 没加载的章节只能看，不能切页；加载后才能选页
              onClickHeader={() => {
                if (isCurrent) onSelectPage(pageIndex);
              }}
              onItemDragStart={onItemDragStart}
              onDoubleClickItem={onDoubleClickItem}
              onClickItem={onClickItem}
              onPreviewHoldStart={onPreviewHoldStart}
              onPreviewHoldEnd={onPreviewHoldEnd}
              activeSequenceId={activeSequenceId}
              itemIndexOffset={pageIndex * PROGRAM_SLOTS_PER_PAGE}
            />
          ))}
        </div>
      )}
    </div>
  );
};
