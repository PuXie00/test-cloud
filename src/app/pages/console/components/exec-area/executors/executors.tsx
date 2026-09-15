import { getMotionItemRepairIssue } from "@/app/project/project-motion-readiness";
import { PROGRAM_SLOTS_PER_PAGE } from "@/app/pages/console/components/program-panel/program-data";
import { useProject } from "@/app/project/use-project";
import { useProgram } from "../../../hooks/use-program";
import { useExecutorSlots } from "../../../hooks/use-executor-slots";
import { ExecutorPaginationBar } from "./executor-pagination-bar";
import { ExecutorSectionGuide } from "./executor-section-guide";
import { FaderSlot } from "./fader-slot";

type ExecutorsProps = {
  onTriggerSequence: (slotIndex: number, sequenceId: number) => void;
};

export const Executors = ({ onTriggerSequence }: ExecutorsProps) => {
  const { faderSlots, setFaderValue } = useExecutorSlots();
  const { program, reorderItemInChapter, moveItemAcrossChapter, currentChapterId, currentPageIndex } =
    useProgram();
  const { currentProject } = useProject();
  const document = currentProject?.document;

  const handleAssignFromDrag =
    (targetSlotIndex: number) =>
    (payload: { chapterId: string; index: number; kind: "sequence" }) => {
      if (payload.kind !== "sequence") return;
      const targetChapter = program.chapters.find((chapter) => chapter.id === currentChapterId);
      if (!targetChapter) return;
      const insertAt = Math.min(
        targetSlotIndex + currentPageIndex * PROGRAM_SLOTS_PER_PAGE,
        targetChapter.items.length,
      );
      if (payload.chapterId === currentChapterId) {
        reorderItemInChapter(currentChapterId, payload.index, insertAt);
      } else {
        moveItemAcrossChapter(payload.chapterId, payload.index, currentChapterId, insertAt);
      }
    };

  return (
    <section className="flex h-full flex-col bg-muted">
      <ExecutorPaginationBar />
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3">
        <div className="flex h-full min-h-0 gap-2">
          <ExecutorSectionGuide className="self-stretch" />
          <div className="grid h-full min-w-0 flex-1 grid-cols-8 gap-2">
            {faderSlots.map((slot) => {
              const repairMessage =
                document && slot.sequence
                  ? getMotionItemRepairIssue(document, "sequence", slot.sequence.id)?.message ??
                    null
                  : null;
              return (
                <FaderSlot
                  key={slot.index}
                  slot={slot}
                  repairMessage={repairMessage}
                  onGo={() => slot.sequence && onTriggerSequence(slot.index, slot.sequence.id)}
                  onFaderChange={(value) => setFaderValue(slot.index, value)}
                  onAssignFromDrag={handleAssignFromDrag(slot.index)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
