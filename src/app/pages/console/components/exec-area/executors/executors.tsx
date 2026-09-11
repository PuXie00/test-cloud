import { getMotionItemRepairIssue } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { useProgram } from "../../../hooks/use-program";
import { useExecutorSlots } from "../../../hooks/use-executor-slots";
import { ButtonSlot } from "./button-slot";
import { ExecutorPaginationBar } from "./executor-pagination-bar";
import { ExecutorSectionGuide } from "./executor-section-guide";
import { FaderSlot } from "./fader-slot";

type ExecutorsProps = {
  onTriggerCue: (slotIndex: number, cueId: string) => void;
  onTriggerSequence: (slotIndex: number, sequenceId: number) => void;
};

export const Executors = ({ onTriggerCue, onTriggerSequence }: ExecutorsProps) => {
  const { buttonSlots, faderSlots, setFaderValue } = useExecutorSlots();
  const { program, reorderItemInChapter, moveItemAcrossChapter, currentChapterId } = useProgram();
  const { currentProject } = useProject();
  const document = currentProject?.document;

  const handleAssignFromDrag = (
    targetKind: "cue" | "sequence",
    targetSlotIndex: number
  ) =>
    (payload: { chapterId: string; index: number; kind: "cue" | "sequence" }) => {
      if (payload.kind !== targetKind) return;
      const targetChapter = program.chapters.find((chapter) => chapter.id === currentChapterId);
      if (!targetChapter) return;
      const targetGlobalIndex = targetChapter.items.findIndex((item, idx) => {
        const sameKindBefore = targetChapter.items
          .slice(0, idx + 1)
          .filter((entry) => entry.kind === targetKind).length;
        return item.kind === targetKind && sameKindBefore === targetSlotIndex + 1;
      });
      const insertAt = targetGlobalIndex >= 0 ? targetGlobalIndex : targetChapter.items.length;
      if (payload.chapterId === currentChapterId) {
        reorderItemInChapter(currentChapterId, payload.index, insertAt);
      } else {
        moveItemAcrossChapter(payload.chapterId, payload.index, currentChapterId, insertAt);
      }
    };

  return (
    <section className="flex h-full flex-col bg-muted">
      <ExecutorPaginationBar />
      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-3 flex gap-2">
          <ExecutorSectionGuide kind="cue" className="h-[118px]" />
          <div className="grid min-w-0 flex-1 grid-cols-8 gap-2">
            {buttonSlots.map((slot) => {
              const repairMessage =
                document && slot.cue
                  ? getMotionItemRepairIssue(document, "cue", slot.cue.id)?.message ?? null
                  : null;
              return (
                <ButtonSlot
                  key={slot.index}
                  slot={slot}
                  repairMessage={repairMessage}
                  onGo={() => slot.cue && onTriggerCue(slot.index, slot.cue.id)}
                  onAssignFromDrag={handleAssignFromDrag("cue", slot.index)}
                />
              );
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <ExecutorSectionGuide kind="sequence" className="h-[140px]" />
          <div className="grid min-w-0 flex-1 grid-cols-8 gap-2">
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
                  onAssignFromDrag={handleAssignFromDrag("sequence", slot.index)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
