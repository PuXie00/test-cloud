import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/app/components/ui/utils";
import {
  capturePreparedPoses,
  evaluateStartGate,
  hpyFromPositions,
  preparedPosesMatchTelemetry,
  type HpyPose,
  type StartGateOptions,
  type StartGateResult,
} from "@/app/project/action-sequence/initial-pose-gate";
import type { NearestStartPlan } from "@/app/project/action-sequence/nearest-start";
import { hasUncoupledSequenceMember, sequenceObjectIds } from "@/app/project/action-sequence/sequence-object-ids";
import { resolveMotionLaunchBlock } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { sequenceTotalMs } from "../../hooks/action-card-seed";
import { useControlledObjects } from "../../hooks/use-controlled-objects";
import { useExecutorSlots, type FaderSlotState } from "../../hooks/use-executor-slots";
import { useExecCards } from "../../hooks/use-exec-cards";
import { useProgram } from "../../hooks/use-program";
import { nextChapterSequence, nextSequenceSlot } from "../../hooks/sequence-run-status";
import { goSequence, readySequence } from "../../hooks/sequence-execution";
import { useSequencePreview } from "../../hooks/use-sequence-preview";
import { useBuildDebug } from "../build-debug/build-debug-context";
import { ExecCards } from "./exec-cards/exec-cards";
import { Executors } from "./executors/executors";
import { InitialPoseDialog, type StartTransitionSummary } from "./initial-pose-dialog";
import { PreparedPoseDialog } from "./prepared-pose-dialog";

type ExecAreaProps = { className?: string };

type PoseDialogState = StartGateOptions & {
  intent: "fader" | "next";
  slotIndex: number;
  cardId: string | null;
  sequenceId: number;
  telemetryByObjectId: Map<number, HpyPose>;
};

const slotReadyOptions = (slot: FaderSlotState) => ({
  safeGroup: slot.runOptions.safeGroup ? 1 : 0,
  runDirection: !slot.runOptions.reverse,
});

const needsPoseDialog = (gate: StartGateResult): boolean => gate.status !== "at-start";

const summaryOf = (
  gate: StartGateResult | null,
  options: StartGateOptions,
): StartTransitionSummary | null => {
  if (!gate || (gate.status !== "transition" && gate.status !== "blocked")) return null;
  return {
    forced: gate.plan.forced,
    nearest: options.nearest,
    reverse: options.reverse,
    targetFrameMs: gate.plan.targetFrameMs,
    transitionSeconds: gate.transitionSeconds,
    programSeconds: gate.programSeconds,
    totalSeconds: gate.totalSeconds,
  };
};

const reportSequenceResult = (result: { toast: "warning" | "error"; message: string }) => {
  if (result.toast === "warning") toast.warning(result.message);
  else toast.error(result.message);
};

export const ExecArea = ({ className }: ExecAreaProps) => {
  const { faderSlots, setSlotBusy, setSlotRunning, markSlotReady, clearSlotReady } =
    useExecutorSlots();
  const { cards, launch, close } = useExecCards();
  const { program, currentChapterId } = useProgram();
  const { currentProject } = useProject();
  const { coupledObjectIds } = useBuildDebug();
  const { snapshots } = useControlledObjects();
  const { stopPreview } = useSequencePreview();
  const [poseDialog, setPoseDialog] = useState<PoseDialogState | null>(null);
  const [preparedPoseAlert, setPreparedPoseAlert] = useState<number | null>(null);
  const poseConfirmLockRef = useRef(false);

  const telemetryByObjectId = useMemo(() => {
    const map = new Map<number, HpyPose>();
    for (const snapshot of snapshots) {
      map.set(snapshot.descriptor.id, hpyFromPositions(snapshot.positions));
    }
    return map;
  }, [snapshots]);
  const telemetryRef = useRef(telemetryByObjectId);
  telemetryRef.current = telemetryByObjectId;

  useEffect(() => {
    if (!poseDialog) poseConfirmLockRef.current = false;
  }, [poseDialog]);

  useEffect(() => {
    const runningSlots = new Set(
      cards.flatMap((card) =>
        card.source.kind === "fader" &&
        (card.status === "running" ||
          card.status === "paused" ||
          card.status === "stopping" ||
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
    if (!document) return null;
    const sequence = faderSlots[poseDialog.slotIndex]?.sequence;
    if (!sequence || sequence.id !== poseDialog.sequenceId) return null;
    const authored = document.motion.actionSequences.find((entry) => entry.id === poseDialog.sequenceId);
    if (!authored) return null;
    return evaluateStartGate({
      sequence: authored,
      objects: document.setup.controlledObjects,
      motors: document.setup.motors,
      telemetryByObjectId: poseDialog.telemetryByObjectId,
      nearest: poseDialog.nearest,
      reverse: poseDialog.reverse,
    });
  }, [poseDialog, currentProject, faderSlots]);

  /** 准备一个推子槽；成功后槽显示“已准备”。 */
  const readySlot = async (
    slotIndex: number,
    sequenceId: number,
    startPlan: NearestStartPlan | null,
    options: { safeGroup: number; runDirection: boolean },
  ): Promise<boolean> => {
    const document = currentProject?.document;
    if (!document) return false;
    const readied = await readySequence({ document, sequenceId, startPlan, ...options });
    if (!readied.ok) {
      clearSlotReady(slotIndex);
      reportSequenceResult(readied);
      return false;
    }
    const authored = document.motion.actionSequences.find((entry) => entry.id === sequenceId);
    markSlotReady(
      slotIndex,
      sequenceId,
      readied.fingerprint,
      startPlan,
      capturePreparedPoses(authored ? sequenceObjectIds(authored) : [], telemetryRef.current),
    );
    return true;
  };

  /** GO 一个推子槽；成功后槽显示“启动”，并出一张来源为该槽的任务卡。 */
  const goSlot = async (slot: FaderSlotState, sequenceId: number): Promise<void> => {
    const document = currentProject?.document;
    if (!document) return;
    const started = await goSequence({
      document,
      sequenceId,
      faderPercent: slot.faderValue,
      reverse: slot.runOptions.reverse,
    });
    if (!started.ok) {
      reportSequenceResult(started);
      return;
    }
    const authored = document.motion.actionSequences.find((entry) => entry.id === sequenceId);
    clearSlotReady(slot.index);
    setSlotRunning(slot.index, true);
    launch({
      kind: "sequence",
      name: started.name,
      durationMs: null,
      source: { kind: "fader", slotIndex: slot.index },
      speedPercent: started.speedPercent,
      sequenceId,
      sequenceHandle: started.sequenceHandle,
      trajectoryMode: slot.sequence?.trajectoryMode,
      totalMs: sequenceTotalMs(authored),
      reverse: slot.runOptions.reverse,
    });
    stopPreview();
  };

  const beginReady = (
    slotIndex: number,
    sequenceId: number,
    startPlan: NearestStartPlan | null,
    options: { safeGroup: number; runDirection: boolean },
  ) => {
    if (!currentProject?.document) return;
    setSlotBusy(slotIndex, true);
    void (async () => {
      try {
        await readySlot(slotIndex, sequenceId, startPlan, options);
      } finally {
        setSlotBusy(slotIndex, false);
      }
    })();
  };

  /**
   * 任务卡的“下一条”：在下一条序列所在的推子槽上把准备和 GO 连着做，
   * 槽的状态（已准备、启动）和手动操作该槽时一致。
   */
  const readyThenGoNext = (
    cardId: string,
    slot: FaderSlotState,
    sequenceId: number,
    startPlan: NearestStartPlan | null,
  ) => {
    if (!currentProject?.document) return;
    setSlotBusy(slot.index, true);
    void (async () => {
      try {
        if (slot.phase !== "ready") {
          const readied = await readySlot(slot.index, sequenceId, startPlan, slotReadyOptions(slot));
          if (!readied) return;
        }
        close(cardId);
        await goSlot(slot, sequenceId);
      } finally {
        setSlotBusy(slot.index, false);
      }
    })();
  };

  const handleConfirmPose = () => {
    if (!poseDialog || dialogGate?.status !== "transition") return;
    if (poseConfirmLockRef.current) return;
    const slot = faderSlots[poseDialog.slotIndex];
    if (!slot || slot.isBusy) return;
    if (poseDialog.intent === "next" && !poseDialog.cardId) return;
    poseConfirmLockRef.current = true;
    const { slotIndex, sequenceId, cardId } = poseDialog;
    const plan = dialogGate.plan;
    setPoseDialog(null);
    if (poseDialog.intent === "next" && cardId) {
      readyThenGoNext(cardId, slot, sequenceId, plan);
      return;
    }
    beginReady(slotIndex, sequenceId, plan, slotReadyOptions(slot));
  };

  const handleNextSequence = (cardId: string) => {
    const card = cards.find((entry) => entry.id === cardId);
    if (!card || card.status !== "stopped" || card.sequenceId === undefined || poseDialog) return;
    const chapterItems =
      program.chapters.find((chapter) => chapter.id === currentChapterId)?.items ??
      program.chapters[0]?.items ??
      [];
    const next = nextChapterSequence(chapterItems, card.sequenceId);
    if (!next || cards.some((entry) => entry.sequenceId === next.sequence.id)) return;
    const sequenceId = next.sequence.id;
    const slot = nextSequenceSlot(chapterItems, card.sequenceId, faderSlots);
    if (!slot) {
      toast.warning("下一条序列不在当前页的推子槽中");
      return;
    }
    if (slot.isBusy || slot.phase === "running") return;
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
      if (
        authored &&
        slot.preparedPoses &&
        !preparedPosesMatchTelemetry(
          slot.preparedPoses,
          document.setup.controlledObjects,
          telemetryByObjectId,
        )
      ) {
        setPreparedPoseAlert(slot.index);
        return;
      }
      readyThenGoNext(cardId, slot, sequenceId, slot.startPlan);
      return;
    }
    let startPlan: NearestStartPlan | null = null;
    if (authored) {
      const gate = evaluateStartGate({
        sequence: authored,
        objects: document.setup.controlledObjects,
        motors: document.setup.motors,
        telemetryByObjectId,
        ...slot.runOptions,
      });
      if (needsPoseDialog(gate)) {
        setPoseDialog({
          intent: "next",
          slotIndex: slot.index,
          cardId,
          sequenceId,
          ...slot.runOptions,
          telemetryByObjectId: new Map(telemetryByObjectId),
        });
        return;
      }
      if (gate.status === "at-start") startPlan = gate.plan;
    }
    readyThenGoNext(cardId, slot, sequenceId, startPlan);
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
      if (
        authored &&
        slot.preparedPoses &&
        !preparedPosesMatchTelemetry(
          slot.preparedPoses,
          document.setup.controlledObjects,
          telemetryByObjectId,
        )
      ) {
        setPreparedPoseAlert(slotIndex);
        return;
      }
      setSlotBusy(slotIndex, true);
      void (async () => {
        try {
          await goSlot(slot, sequenceId);
        } finally {
          setSlotBusy(slotIndex, false);
        }
      })();
      return;
    }

    if (poseDialog) return;
    let startPlan: NearestStartPlan | null = null;
    if (authored) {
      const gate = evaluateStartGate({
        sequence: authored,
        objects: document.setup.controlledObjects,
        motors: document.setup.motors,
        telemetryByObjectId,
        ...slot.runOptions,
      });
      if (needsPoseDialog(gate)) {
        setPoseDialog({
          intent: "fader",
          slotIndex,
          cardId: null,
          sequenceId,
          ...slot.runOptions,
          telemetryByObjectId: new Map(telemetryByObjectId),
        });
        return;
      }
      if (gate.status === "at-start") startPlan = gate.plan;
    }
    beginReady(slotIndex, sequenceId, startPlan, slotReadyOptions(slot));
  };

  return (
    <section className={cn("flex min-h-0 overflow-hidden rounded-lg bg-card", className)}>
      <div className="flex h-full w-[330px] shrink-0 flex-col">
        <ExecCards onNextSequence={handleNextSequence} />
      </div>
      <div className="min-w-0 flex-1">
        <Executors onTriggerSequence={handleTriggerSequence} />
      </div>
      <InitialPoseDialog
        open={poseDialog !== null}
        summary={poseDialog ? summaryOf(dialogGate, poseDialog) : null}
        blockedMessage={dialogGate?.status === "blocked" ? dialogGate.message : null}
        errorMessage={dialogGate?.status === "error" ? dialogGate.message : null}
        onCancel={() => setPoseDialog(null)}
        onConfirm={handleConfirmPose}
      />
      {preparedPoseAlert !== null ? (
        <PreparedPoseDialog
          open
          onConfirm={() => {
            clearSlotReady(preparedPoseAlert);
            setPreparedPoseAlert(null);
          }}
        />
      ) : null}
    </section>
  );
};
