import { useEffect } from "react";
import { toast } from "sonner";
import { cn } from "@/app/components/ui/utils";
import { resolveMotionLaunchBlock } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { useExecutorSlots } from "../../hooks/use-executor-slots";
import { useExecCards } from "../../hooks/use-exec-cards";
import { goSequence, readySequence } from "../../hooks/sequence-execution";
import { useSequencePreview } from "../../hooks/use-sequence-preview";
import { ExecCards } from "./exec-cards/exec-cards";
import { Executors } from "./executors/executors";

type ExecAreaProps = { className?: string };

const reportSequenceResult = (result: { toast: "warning" | "error"; message: string }) => {
  if (result.toast === "warning") toast.warning(result.message);
  else toast.error(result.message);
};

export const ExecArea = ({ className }: ExecAreaProps) => {
  const { faderSlots, setSlotBusy, setSlotRunning, markSlotReady, clearSlotReady } =
    useExecutorSlots();
  const { cards, launch } = useExecCards();
  const { currentProject } = useProject();
  const { stopPreview } = useSequencePreview();

  useEffect(() => {
    const runningSlots = new Set(
      cards
        .filter(
          (card) =>
            card.source.kind === "fader" &&
            (card.status === "running" ||
              card.status === "paused" ||
              card.status === "stopped") &&
            !card.emergencyStopped,
        )
        .map((card) => card.source.slotIndex),
    );
    for (const slot of faderSlots) {
      setSlotRunning(slot.index, runningSlots.has(slot.index));
    }
  }, [cards, faderSlots, setSlotRunning]);

  const handleTriggerSequence = (slotIndex: number, sequenceId: number) => {
    const slot = faderSlots[slotIndex];
    if (!slot?.sequence || slot.isBusy || slot.phase === "running") return;
    const document = currentProject?.document;
    const issue = resolveMotionLaunchBlock(document, "sequence", sequenceId);
    if (issue) {
      toast.warning(issue.message);
      return;
    }
    if (!document) return;

    if (slot.phase === "ready") {
      const faderPercent = slot.faderValue;
      setSlotBusy(slotIndex, true);
      void (async () => {
        try {
          const started = await goSequence({
            document,
            sequenceId,
            faderPercent,
          });
          if (!started.ok) {
            reportSequenceResult(started);
            return;
          }
          clearSlotReady(slotIndex);
          setSlotRunning(slotIndex, true);
          launch({
            kind: "sequence",
            name: started.name,
            durationMs: null,
            source: { kind: "fader", slotIndex },
            speedPercent: started.speedPercent,
            sequenceId,
            sequenceHandle: started.sequenceHandle,
            trajectoryMode: slot.sequence.trajectoryMode,
            safetyGroup: slot.safetyGroup,
            nearestStart: slot.nearestStart,
          });
          stopPreview();
        } finally {
          setSlotBusy(slotIndex, false);
        }
      })();
      return;
    }

    setSlotBusy(slotIndex, true);
    void (async () => {
      try {
        const readied = await readySequence({ document, sequenceId });
        if (!readied.ok) {
          clearSlotReady(slotIndex);
          reportSequenceResult(readied);
          return;
        }
        markSlotReady(slotIndex, sequenceId, readied.fingerprint);
      } finally {
        setSlotBusy(slotIndex, false);
      }
    })();
  };

  return (
    <section className={cn("flex min-h-0 overflow-hidden rounded-lg bg-card", className)}>
      <div className="flex h-full w-[330px] shrink-0 flex-col border-r border-border/60">
        <ExecCards />
      </div>
      <div className="min-w-0 flex-1">
        <Executors onTriggerSequence={handleTriggerSequence} />
      </div>
    </section>
  );
};
