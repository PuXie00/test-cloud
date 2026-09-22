import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/app/components/ui/utils";
import {
  evaluateInitialPoseGate,
  hpyFromPositions,
  type PoseSpeedMode,
} from "@/app/project/action-sequence/initial-pose-gate";
import type { HpyPose, InitialTransitionPlan } from "@/app/project/action-sequence/initial-transition-planner";
import { hasUncoupledSequenceMember } from "@/app/project/action-sequence/sequence-object-ids";
import { resolveMotionLaunchBlock } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { useControlledObjects } from "../../hooks/use-controlled-objects";
import { useExecutorSlots } from "../../hooks/use-executor-slots";
import { useExecCards } from "../../hooks/use-exec-cards";
import { goSequence, readySequence } from "../../hooks/sequence-execution";
import { useSequencePreview } from "../../hooks/use-sequence-preview";
import { useBuildDebug } from "../build-debug/build-debug-context";
import { ExecCards } from "./exec-cards/exec-cards";
import { Executors } from "./executors/executors";
import { InitialPoseDialog } from "./initial-pose-dialog";

type ExecAreaProps = { className?: string };

type PoseDialogState = {
  slotIndex: number;
  sequenceId: number;
  speedMode: PoseSpeedMode;
};

const reportSequenceResult = (result: { toast: "warning" | "error"; message: string }) => {
  if (result.toast === "warning") toast.warning(result.message);
  else toast.error(result.message);
};

export const ExecArea = ({ className }: ExecAreaProps) => {
  const { faderSlots, setSlotBusy, setSlotRunning, markSlotReady, clearSlotReady } =
    useExecutorSlots();
  const { cards, launch } = useExecCards();
  const { currentProject } = useProject();
  const { coupledObjectIds } = useBuildDebug();
  const { snapshots } = useControlledObjects();
  const { stopPreview } = useSequencePreview();
  const [poseDialog, setPoseDialog] = useState<PoseDialogState | null>(null);

  const telemetryByObjectId = useMemo(() => {
    const map = new Map<number, HpyPose>();
    for (const snapshot of snapshots) {
      map.set(snapshot.descriptor.id, hpyFromPositions(snapshot.positions));
    }
    return map;
  }, [snapshots]);

  useEffect(() => {
    const runningSlots = new Set(
      cards.flatMap((card) =>
        card.source.kind === "fader" &&
        (card.status === "running" ||
          card.status === "paused" ||
          card.status === "stopped") &&
        !card.emergencyStopped
          ? [card.source.slotIndex]
          : [],
      ),
    );
    for (const slot of faderSlots) {
      setSlotRunning(slot.index, runningSlots.has(slot.index));
    }
  }, [cards, faderSlots, setSlotRunning]);

  const dialogGate = useMemo(() => {
    if (!poseDialog) return null;
    const document = currentProject?.document;
    const sequence = faderSlots[poseDialog.slotIndex]?.sequence;
    if (!document || !sequence || sequence.id !== poseDialog.sequenceId) return null;
    const authored = document.motion.actionSequences.find((entry) => entry.id === poseDialog.sequenceId);
    if (!authored) return null;
    return evaluateInitialPoseGate({
      sequence: authored,
      objects: document.setup.controlledObjects,
      motors: document.setup.motors,
      telemetryByObjectId,
      speedMode: poseDialog.speedMode,
      sequenceDurationMs: sequence.durationMs,
    });
  }, [poseDialog, currentProject, faderSlots, telemetryByObjectId]);

  const beginReady = (
    slotIndex: number,
    sequenceId: number,
    initialTransition: InitialTransitionPlan | null,
  ) => {
    const document = currentProject?.document;
    if (!document) return;
    setSlotBusy(slotIndex, true);
    void (async () => {
      try {
        const readied = await readySequence({ document, sequenceId });
        if (!readied.ok) {
          clearSlotReady(slotIndex);
          reportSequenceResult(readied);
          return;
        }
        markSlotReady(slotIndex, sequenceId, readied.fingerprint, initialTransition);
      } finally {
        setSlotBusy(slotIndex, false);
      }
    })();
  };

  const handleConfirmPose = () => {
    if (!poseDialog || dialogGate?.status !== "transition") return;
    const { slotIndex, sequenceId } = poseDialog;
    const plan = dialogGate.plan;
    setPoseDialog(null);
    beginReady(slotIndex, sequenceId, plan);
  };

  const handleTriggerSequence = (slotIndex: number, sequenceId: number) => {
    const slot = faderSlots[slotIndex];
    const sequence = slot?.sequence;
    if (!slot || !sequence || slot.isBusy || slot.phase === "running") return;
    const document = currentProject?.document;
    const issue = resolveMotionLaunchBlock(document, "sequence", sequenceId);
    if (issue) {
      toast.warning(issue.message);
      return;
    }
    if (!document) return;

    const authored = document.motion.actionSequences.find((entry) => entry.id === sequenceId);
    if (authored && hasUncoupledSequenceMember(authored, coupledObjectIds)) {
      toast.warning("未耦合");
      return;
    }

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
            trajectoryMode: sequence.trajectoryMode,
          });
          stopPreview();
        } finally {
          setSlotBusy(slotIndex, false);
        }
      })();
      return;
    }

    if (poseDialog) return;
    if (authored) {
      const gate = evaluateInitialPoseGate({
        sequence: authored,
        objects: document.setup.controlledObjects,
        motors: document.setup.motors,
        telemetryByObjectId,
        speedMode: "default",
        sequenceDurationMs: sequence.durationMs,
      });
      if (gate.status === "error" || gate.status === "transition") {
        setPoseDialog({ slotIndex, sequenceId, speedMode: "default" });
        return;
      }
    }
    beginReady(slotIndex, sequenceId, null);
  };

  return (
    <section className={cn("flex min-h-0 overflow-hidden rounded-lg bg-card", className)}>
      <div className="flex h-full w-[330px] shrink-0 flex-col">
        <ExecCards />
      </div>
      <div className="min-w-0 flex-1">
        <Executors onTriggerSequence={handleTriggerSequence} />
      </div>
      <InitialPoseDialog
        open={poseDialog !== null}
        speedMode={poseDialog?.speedMode ?? "default"}
        extraSeconds={dialogGate?.status === "transition" ? dialogGate.extraSeconds : null}
        totalSeconds={dialogGate?.status === "transition" ? dialogGate.totalSeconds : null}
        errorMessage={dialogGate?.status === "error" ? dialogGate.message : null}
        onSpeedModeChange={(speedMode) => {
          setPoseDialog((current) => (current ? { ...current, speedMode } : current));
        }}
        onCancel={() => setPoseDialog(null)}
        onConfirm={handleConfirmPose}
      />
    </section>
  );
};
