import { cn } from "@/app/components/ui/utils";
import { getProgramRepairIssues } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { useProgram } from "../../hooks/use-program";
import { useSelection } from "../../hooks/use-selection";
import { AuthoringProgramPanel } from "./authoring-program-panel";
import type { ChapterItem } from "./program-data";
import { ProgramHeader } from "./program-header";
import { ChapterSection } from "./chapter-section";
import { ProgramEmptyGuide } from "./program-empty-guide";

export type ProgramPanelVariant = "authoring" | "control";

type ProgramPanelProps = {
  variant: ProgramPanelVariant;
  className?: string;
};

const ControlProgramPanel = ({ className }: { className?: string }) => {
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
  const programRepairIssues = document ? getProgramRepairIssues(document, program.id) : [];
  const programRepairWarning =
    programRepairIssues.length > 0
      ? programRepairIssues.map((issue) => issue.message).join("；")
      : null;

  const handleItemDragStart =
    (chapterId: string, item: ChapterItem, index: number) =>
    (event: React.DragEvent) => {
      event.dataTransfer.setData(
        "application/x-console-item",
        JSON.stringify({ chapterId, index, kind: item.kind }),
      );
      event.dataTransfer.effectAllowed = "move";
    };

  const handleSelectPage = (chapterId: string, pageIndex: number) => {
    if (chapterId !== currentChapterId) setCurrentChapter(chapterId);
    if (pageIndex > currentPageIndex) {
      for (let i = currentPageIndex; i < pageIndex; i += 1) nextPage();
    } else if (pageIndex < currentPageIndex) {
      for (let i = currentPageIndex; i > pageIndex; i -= 1) prevPage();
    }
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      <ProgramHeader
        programName={program.name}
        programNote={program.note}
        repairWarning={programRepairWarning}
        onAddChapter={addChapter}
        onProgramSettings={() => clearSelection()}
        showChapterActions={!isProgramEmpty}
      />
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
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
              onSelectPage={(pageIndex) => handleSelectPage(chapter.id, pageIndex)}
              onAddSequence={() => addSequence(chapter.id)}
              onItemDragStart={handleItemDragStart}
            />
          ))
        )}
      </div>
    </div>
  );
};

export const ProgramPanel = ({ variant, className }: ProgramPanelProps) =>
  variant === "authoring" ? (
    <AuthoringProgramPanel className={className} />
  ) : (
    <ControlProgramPanel className={className} />
  );
