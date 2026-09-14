import { cn } from "@/app/components/ui/utils";
import { getProgramRepairIssues } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { useProgram } from "../../hooks/use-program";
import { useSelection } from "../../hooks/use-selection";
import type { ChapterItem } from "./program-data";
import { ProgramHeader } from "./program-header";
import { ChapterSection } from "./chapter-section";
import { ProgramEmptyGuide } from "./program-empty-guide";

type ProgramPanelProps = { className?: string };

export const ProgramPanel = ({ className }: ProgramPanelProps) => {
  const {
    program,
    currentChapterId,
    currentPageIndex,
    setCurrentChapter,
    nextPage,
    prevPage,
    addChapter,
    addSequence,
    isProgramEmpty,
  } = useProgram();
  const { clearSelection } = useSelection();
  const { currentProject } = useProject();
  const document = currentProject?.document;
  const programRepairIssues = document
    ? getProgramRepairIssues(document, program.id)
    : [];
  const programRepairWarning =
    programRepairIssues.length > 0
      ? programRepairIssues.map((issue) => issue.message).join("；")
      : null;

  const handleItemDragStart =
    (chapterId: string, item: ChapterItem, index: number) =>
    (event: React.DragEvent) => {
      event.dataTransfer.setData(
        "application/x-console-item",
        JSON.stringify({ chapterId, index, kind: item.kind })
      );
      event.dataTransfer.effectAllowed = "move";
    };

  return (
    <aside className={cn("flex shrink-0 flex-col bg-card overflow-hidden rounded-lg", className)}>
      <ProgramHeader
        programName={program.name}
        programNote={program.note}
        repairWarning={programRepairWarning}
        onAddChapter={addChapter}
        onProgramSettings={() => clearSelection()}
        showChapterActions={!isProgramEmpty}
      />
      <div className="custom-scrollbar flex-1 overflow-y-auto">
        {isProgramEmpty ? (
          <ProgramEmptyGuide />
        ) : (
          program.chapters.map((chapter) => (
          <ChapterSection
            key={chapter.id}
            chapter={chapter}
            isCurrent={chapter.id === currentChapterId}
            currentPageIndex={currentPageIndex}
            onSelectChapter={() => setCurrentChapter(chapter.id)}
            onSelectPage={(pageIndex) => {
              if (chapter.id !== currentChapterId) setCurrentChapter(chapter.id);
              if (pageIndex > currentPageIndex) {
                for (let i = currentPageIndex; i < pageIndex; i += 1) nextPage();
              } else if (pageIndex < currentPageIndex) {
                for (let i = currentPageIndex; i > pageIndex; i -= 1) prevPage();
              }
            }}
            onAddSequence={() => addSequence(chapter.id)}
            onItemDragStart={handleItemDragStart}
          />
          ))
        )}
      </div>
    </aside>
  );
};
