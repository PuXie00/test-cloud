import { ChevronLeft, ChevronRight } from "lucide-react";
import { GoToSequencesButton } from "../../program-panel/go-to-sequences-button";
import { useProgram } from "../../../hooks/use-program";

export const ExecutorPaginationBar = () => {
  const {
    program,
    currentChapterId,
    currentPageIndex,
    totalPages,
    setCurrentChapter,
    nextPage,
    prevPage,
    isProgramEmpty,
  } = useProgram();

  const currentChapter = program.chapters.find((chapter) => chapter.id === currentChapterId);

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 pr-2">
      <button
        type="button"
        aria-label="上一页"
        disabled={isProgramEmpty || currentPageIndex === 0}
        onClick={prevPage}
        className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">
        页 {currentPageIndex + 1}/{totalPages}
      </span>
      <button
        type="button"
        aria-label="下一页"
        disabled={isProgramEmpty || currentPageIndex >= totalPages - 1}
        onClick={nextPage}
        className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      <span className="ml-3 truncate text-label-caps text-foreground">
        {isProgramEmpty ? "暂无章节" : (currentChapter?.name ?? "未选择章节")}
      </span>
      {isProgramEmpty ? (
        <GoToSequencesButton size="sm" className="ml-auto shrink-0" />
      ) : (
        <select
          value={currentChapterId}
          onChange={(event) => setCurrentChapter(event.target.value)}
          className="ml-auto h-7 rounded-sm border border-border bg-input-background px-2 text-body-sm text-foreground"
          aria-label="选择章节"
        >
          {program.chapters.map((chapter) => (
            <option key={chapter.id} value={chapter.id}>
              {chapter.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
};
