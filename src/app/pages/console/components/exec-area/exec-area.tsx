import { toast } from "sonner";
import { cn } from "@/app/components/ui/utils";
import { resolveMotionLaunchBlock } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { useExecutorSlots } from "../../hooks/use-executor-slots";
import { useExecCards } from "../../hooks/use-exec-cards";
import { startLocalAuthoredSequence } from "../../hooks/sequence-execution";
import { ExecCards } from "./exec-cards/exec-cards";
import { Executors } from "./executors/executors";

type ExecAreaProps = { className?: string };

export const ExecArea = ({ className }: ExecAreaProps) => {
  const { faderSlots } = useExecutorSlots();
  const { launch } = useExecCards();
  const { currentProject } = useProject();

  return (
    <section className={cn("flex min-h-0 overflow-hidden rounded-lg bg-card", className)}>
      <div className="flex h-full w-[330px] shrink-0 flex-col border-r border-border/60">
        <ExecCards />
      </div>
      <div className="min-w-0 flex-1">
        <Executors
          onTriggerSequence={(slotIndex, sequenceId) => {
            const slot = faderSlots[slotIndex];
            if (!slot?.sequence) return;
            const document = currentProject?.document;
            const issue = resolveMotionLaunchBlock(document, "sequence", sequenceId);
            if (issue) {
              toast.warning(issue.message);
              return;
            }
            if (!document) return;
            void (async () => {
              const started = await startLocalAuthoredSequence({
                document,
                sequenceId,
                faderPercent: slot.faderValue,
              });
              if (!started.ok) {
                if (started.toast === "warning") toast.warning(started.message);
                else toast.error(started.message);
                return;
              }
              launch({
                kind: "sequence",
                name: started.name,
                durationMs: null,
                source: { kind: "fader", slotIndex },
                speedPercent: started.speedPercent,
                sequenceHandle: started.sequenceHandle,
              });
            })();
          }}
        />
      </div>
    </section>
  );
};
