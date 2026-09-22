import { getMotionItemRepairIssue } from "@/app/project/project-motion-readiness";
import { PROGRAM_SLOTS_PER_PAGE } from "@/app/pages/console/components/program-panel/program-data";
import { useProject } from "@/app/project/use-project";
import { useProgram } from "../../../hooks/use-program";
import { useExecutorSlots } from "../../../hooks/use-executor-slots";
import { useSequencePreview } from "../../../hooks/use-sequence-preview";
import { ExecutorPaginationBar } from "./executor-pagination-bar";
import { FaderSlot } from "./fader-slot";

type ExecutorsProps = {
  onTriggerSequence: (slotIndex: number, sequenceId: number) => void;
};

export const Executors = ({ onTriggerSequence }: ExecutorsProps) => {
  const { faderSlots, setFaderValue, clearSlotReady } = useExecutorSlots();
  const { program, reorderItemInChapter, moveItemAcrossChapter, currentChapterId, currentPageIndex } =
    useProgram();
  const { currentProject } = useProject();
  const { sequenceId: previewSequenceId, togglePreview, startPreview, stopPreview } =
    useSequencePreview();
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
      <div className="min-h-0 flex-1 overflow-y-hidden py-1 pr-2">
        <div className="h-full min-h-0 min-w-0 overflow-x-auto overflow-y-hidden">
          <div
            className="grid h-full w-full gap-1"
            style={{ gridTemplateColumns: `repeat(${PROGRAM_SLOTS_PER_PAGE}, minmax(72px, 1fr))` }}
          >
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
                  isPreviewing={previewSequenceId === slot.sequence?.id}
                  onPreviewToggle={() =>
                    slot.sequence && togglePreview(slot.sequence.id, { faderPercent: slot.faderValue })
                  }
                  onPreviewHoldStart={() =>
                    slot.sequence &&
                    startPreview(slot.sequence.id, {
                      faderPercent: slot.faderValue,
                      autoplay: true,
                      holdMode: true,
                    })
                  }
                  onPreviewHoldEnd={stopPreview}
                  onGo={() => slot.sequence && onTriggerSequence(slot.index, slot.sequence.id)}
                  onCancelReady={() => clearSlotReady(slot.index)}
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
