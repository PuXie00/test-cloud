import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { defaultStartEntry, type StartEntryChoice } from "@/app/project/action-sequence/start-entry";
import { hasUncoupledSequenceMember, sequenceObjectIds } from "@/app/project/action-sequence/sequence-object-ids";
import { resolveMotionLaunchBlock } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { sequenceTotalMs } from "../../hooks/action-card-seed";
import { canRerunExecCard, isExecCardAtRest } from "../../hooks/exec-card-run-status";
import { useControlledObjects } from "../../hooks/use-controlled-objects";
import { useExecutorSlots, type FaderSlotState } from "../../hooks/use-executor-slots";
import { useExecCards } from "../../hooks/use-exec-cards";
import { useProgram } from "../../hooks/use-program";
import {
  execCardSlot,
  nextChapterSequence,
  nextSequenceSlot,
} from "../../hooks/sequence-run-status";
import {
  goSequence,
  readySequence,
  releaseSequence,
  resolveSequenceSpeedCap,
} from "../../hooks/sequence-execution";
import { useSequencePreview } from "../../hooks/use-sequence-preview";
import { faderToSpeedPercent, PROGRAMMED_SPEED_PERCENT } from "../../hooks/speed-cap";
import { useBuildDebug } from "../build-debug/build-debug-context";
import { ExecCards } from "./exec-cards/exec-cards";
import { Executors } from "./executors/executors";
import { PreparedPoseDialog } from "./prepared-pose-dialog";
import {
  StartEntryDialog,
  type StartEntryIntent,
  type StartEntryRequest,
} from "./start-entry-dialog";

type ExecAreaProps = { className?: string };

type EntryDialogState = {
  intent: StartEntryIntent;
  slotIndex: number;
  cardId: string | null;
  sequenceId: number;
  reverse: boolean;
  /** 继续 / 反向回：停下时的 runTime */
  referenceFrameMs?: number;
  defaultChoice: StartEntryChoice;
  /** 打开时冻结的设备位置，弹窗里的方案都按它算 */
  telemetryByObjectId: Map<number, HpyPose>;
  notice: string | null;
};

type PreparedPoseAlert = { slotIndex: number; sequenceId: number };

const POSITION_CHANGED_NOTICE = "设备位置在弹窗打开后变了，已按现在的位置重新计算，请再确认一次。";

/** 继续沿卡片原来的方向，反向回方向反过来 */
type RerunIntent = "continue" | "reverse-back";

const slotReadyOptions = (slot: FaderSlotState) => ({
  safeGroup: slot.runOptions.safeGroup ? 1 : 0,
  runDirection: !slot.runOptions.reverse,
});

/**
 * 要先过渡、算不出方案时都弹；不用过渡但从曲线中间开始（就近落在中间）也弹，免得 GO 后跳着跑。
 * 继续 / 反向回本来就是从停下处接着走，只有要先过渡时才弹。
 */
const needsEntryDialog = (gate: StartGateResult, intent: StartEntryIntent): boolean =>
  gate.status !== "at-start" || (intent !== "rerun" && gate.midCurve);

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
  const [poseDialog, setPoseDialog] = useState<EntryDialogState | null>(null);
  const [preparedPoseAlert, setPreparedPoseAlert] = useState<PreparedPoseAlert | null>(null);
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
          isExecCardAtRest(card)) &&
        !card.emergencyStopped
          ? [card.source.slotIndex]
          : [],
      ),
    );
    // cards 每帧都在变；只在运行状态真的变化时才 setState，否则每帧都会排一次嵌套更新
    for (const slot of faderSlots) {
      const running = runningSlots.has(slot.index);
      if ((slot.phase === "running") !== running) setSlotRunning(slot.index, running);
    }
  }, [cards, faderSlots, setSlotRunning]);

  // 只依赖槽上的序列 id：推子一动 faderSlots 就变，不能每次都重跑就近搜索
  const dialogSlotSequenceId = poseDialog ? faderSlots[poseDialog.slotIndex]?.sequence?.id : undefined;
  const entryRequest = useMemo((): StartEntryRequest | null => {
    if (!poseDialog) return null;
    const document = currentProject?.document;
    if (!document) return null;
    if (dialogSlotSequenceId !== poseDialog.sequenceId) return null;
    const authored = document.motion.actionSequences.find((entry) => entry.id === poseDialog.sequenceId);
    if (!authored) return null;
    return {
      intent: poseDialog.intent,
      defaultChoice: poseDialog.defaultChoice,
      notice: poseDialog.notice,
      input: {
        sequence: authored,
        objects: document.setup.controlledObjects,
        motors: document.setup.motors,
        telemetryByObjectId: poseDialog.telemetryByObjectId,
        reverse: poseDialog.reverse,
        ...(poseDialog.referenceFrameMs !== undefined
          ? { referenceFrameMs: poseDialog.referenceFrameMs }
          : {}),
      },
    };
  }, [poseDialog, currentProject, dialogSlotSequenceId]);

  // 槽换了序列或序列被删了：弹窗里的方案已经对不上，直接关掉
  useEffect(() => {
    if (poseDialog && !entryRequest) setPoseDialog(null);
  }, [poseDialog, entryRequest]);

  /**
   * 准备一个推子槽；成功后槽显示“已准备”，推子按调速范围封顶。
   * 返回调速上限（百分比，null 为不限）；失败返回 false。
   */
  const readySlot = async (
    slotIndex: number,
    sequenceId: number,
    startPlan: NearestStartPlan | null,
    options: { safeGroup: number; runDirection: boolean },
  ): Promise<{ maxSpeedPercent: number | null } | false> => {
    const document = currentProject?.document;
    if (!document) return false;
    const readied = await readySequence({ document, sequenceId, startPlan, ...options });
    if (!readied.ok) {
      clearSlotReady(slotIndex);
      reportSequenceResult(readied);
      return false;
    }
    const authored = document.motion.actionSequences.find((entry) => entry.id === sequenceId);
    const speedCap = resolveSequenceSpeedCap(document, sequenceId, telemetryRef.current);
    if (!speedCap.ok) toast.warning(speedCap.message);
    else if (speedCap.maxPercent !== null && speedCap.maxPercent < PROGRAMMED_SPEED_PERCENT) {
      toast.warning(`该动作最高只能 ${speedCap.maxPercent}%，低于编程速度`);
    }
    console.log("speedCap", speedCap);
    console.log("readied.fingerprint", readied.fingerprint);
    console.log("startPlan", startPlan);
    markSlotReady(
      slotIndex,
      sequenceId,
      readied.fingerprint,
      startPlan,
      capturePreparedPoses(authored ? sequenceObjectIds(authored) : [], telemetryRef.current),
      speedCap.maxPercent,
    );
    return { maxSpeedPercent: speedCap.maxPercent };
  };

  /**
   * GO 一个推子槽；成功后槽显示“启动”，并出一张来源为该槽的任务卡（同一动作已有卡片时沿用那张）。
   * run 给任务卡的继续 / 反向回用：速度沿用卡上的，方向按按钮定；缺省按推子和槽的反向开关。
   */
  const goSlot = async (
    slot: FaderSlotState,
    sequenceId: number,
    startPlan: NearestStartPlan | null,
    maxSpeedPercent: number | null,
    run?: { speedPercent: number; reverse: boolean },
  ): Promise<boolean> => {
    const document = currentProject?.document;
    if (!document) return false;
    const reverse = run?.reverse ?? slot.runOptions.reverse;
    const started = await goSequence({
      document,
      sequenceId,
      // 用本次准备的调速上限换算：下一条连做时 slot 还是准备前的快照
      faderPercent: run?.speedPercent ?? faderToSpeedPercent(slot.faderValue, maxSpeedPercent),
      reverse,
      startPlan,
      maxSpeedPercent,
    });
    if (!started.ok) {
      reportSequenceResult(started);
      return false;
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
      ...(maxSpeedPercent !== null ? { maxSpeedPercent } : {}),
      sequenceId,
      sequenceHandle: started.sequenceHandle,
      trajectoryMode: slot.sequence?.trajectoryMode,
      totalMs: sequenceTotalMs(authored),
      reverse,
    });
    stopPreview();
    return true;
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
   * 必须先释放上一条动作再准备：释放指令会停掉同一批物体，放在准备之后会把刚准备好的下一条一起停掉
   * （表现为回起始点没有执行、GO 后动作在跑但模型不动）。
   */
  const readyThenGoNext = (
    cardId: string,
    slot: FaderSlotState,
    sequenceId: number,
    startPlan: NearestStartPlan | null,
  ) => {
    if (!currentProject?.document) return;
    const card = cards.find((entry) => entry.id === cardId);
    setSlotBusy(slot.index, true);
    void (async () => {
      try {
        if (card?.sequenceHandle && !card.emergencyStopped) {
          const released = await releaseSequence({
            actionId: card.sequenceHandle.actionId,
            trajectoryMode: card.trajectoryMode === true,
            deviceId: card.sequenceHandle.deviceId ?? [],
          });
          if (!released.ok) {
            reportSequenceResult(released);
            return;
          }
        }
        const readied = await readySlot(slot.index, sequenceId, startPlan, slotReadyOptions(slot));
        if (!readied) return;
        close(cardId, { release: false });
        await goSlot(slot, sequenceId, startPlan, readied.maxSpeedPercent);
      } finally {
        setSlotBusy(slot.index, false);
      }
    })();
  };

  /**
   * 任务卡的继续 / 反向回：同一个动作在它的推子槽上先释放、再按就近计划准备、再 GO，
   * 速度沿用卡上的，GO 后沿用原来那张卡。准备是按这次的方向和接入帧算的，GO 没成功就撤掉准备，
   * 免得推子槽之后按槽自己的开关直接 GO。
   */
  const rerunOnSlot = (
    cardId: string,
    slot: FaderSlotState,
    sequenceId: number,
    startPlan: NearestStartPlan | null,
    reverse: boolean,
  ) => {
    if (!currentProject?.document) return;
    const card = cards.find((entry) => entry.id === cardId);
    if (!card || !canRerunExecCard(card)) return;
    setSlotBusy(slot.index, true);
    void (async () => {
      try {
        // if (card.sequenceHandle) {
        //   const released = await releaseSequence({
        //     actionId: card.sequenceHandle.actionId,
        //     trajectoryMode: card.trajectoryMode === true,
        //     deviceId: card.sequenceHandle.deviceId ?? [],
        //   });
        //   if (!released.ok) {
        //     reportSequenceResult(released);
        //     return;
        //   }
        // }
        const readied = await readySlot(slot.index, sequenceId, startPlan, {
          safeGroup: slot.runOptions.safeGroup ? 1 : 0,
          runDirection: !reverse,
        });
        if (!readied) return;
        const started = await goSlot(slot, sequenceId, startPlan, readied.maxSpeedPercent, {
          speedPercent: card.speedPercent,
          reverse,
        });
        if (!started) clearSlotReady(slot.index);
      } finally {
        setSlotBusy(slot.index, false);
      }
    })();
  };

  const handleConfirmEntry = (plan: NearestStartPlan) => {
    if (!poseDialog || !entryRequest) return;
    if (poseConfirmLockRef.current) return;
    const slot = faderSlots[poseDialog.slotIndex];
    if (!slot || slot.isBusy) return;
    if (poseDialog.intent !== "fader" && !poseDialog.cardId) return;
    // 弹窗开着时设备动过（别的动作、手动）：按现在的位置重算，让操作者再确认一次
    const atOpen = capturePreparedPoses(
      sequenceObjectIds(entryRequest.input.sequence),
      poseDialog.telemetryByObjectId,
    );
    if (!preparedPosesMatchTelemetry(atOpen, entryRequest.input.objects, telemetryRef.current)) {
      setPoseDialog({
        ...poseDialog,
        telemetryByObjectId: new Map(telemetryRef.current),
        notice: POSITION_CHANGED_NOTICE,
      });
      return;
    }
    poseConfirmLockRef.current = true;
    const { slotIndex, sequenceId, cardId } = poseDialog;
    setPoseDialog(null);
    if (poseDialog.intent === "next" && cardId) {
      readyThenGoNext(cardId, slot, sequenceId, plan);
      return;
    }
    if (poseDialog.intent === "rerun" && cardId) {
      rerunOnSlot(cardId, slot, sequenceId, plan, poseDialog.reverse);
      return;
    }
    beginReady(slotIndex, sequenceId, plan, slotReadyOptions(slot));
  };

  const openEntryDialog = (
    state: Omit<EntryDialogState, "defaultChoice" | "telemetryByObjectId" | "notice">,
    options: StartGateOptions,
  ) =>
    setPoseDialog({
      ...state,
      defaultChoice: defaultStartEntry(options),
      telemetryByObjectId: new Map(telemetryByObjectId),
      notice: null,
    });

  /**
   * 继续 / 反向回：开启就近。runTime 就是原曲线帧，正向和反向都把它作为 stopped_time_ms，
   * 沿这次的运行方向找位置最近的接入帧，准备后直接 GO。
   * 只是这一次按就近和该方向走，槽上保存的就近 / 反向开关不变。PLC 没上报过时没有参考帧，从方向起点找。
   */
  const handleRerun = (cardId: string, intent: RerunIntent) => {
    const card = cards.find((entry) => entry.id === cardId);
    if (!card || !canRerunExecCard(card) || card.sequenceId === undefined || poseDialog) return;
    const sequenceId = card.sequenceId;
    const slot = execCardSlot(card, faderSlots);
    if (!slot) {
      toast.warning("该动作不在当前页的推子槽中，翻到它所在的页再操作");
      return;
    }
    if (slot.isBusy) return;
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
    const reverse = intent === "continue" ? card.reverse === true : card.reverse !== true;
    const referenceFrameMs = card.run?.runTimeMs;
    const options: StartGateOptions = {
      nearest: true,
      reverse,
      ...(referenceFrameMs !== undefined ? { referenceFrameMs } : {}),
    };
    console.log("options", options);
    
    let startPlan: NearestStartPlan | null = null;
    if (authored) {
      const gate = evaluateStartGate({
        sequence: authored,
        objects: document.setup.controlledObjects,
        motors: document.setup.motors,
        telemetryByObjectId,
        ...options,
      });
      if (needsEntryDialog(gate, "rerun")) {
        openEntryDialog(
          {
            intent: "rerun",
            slotIndex: slot.index,
            cardId,
            sequenceId,
            reverse,
            ...(referenceFrameMs !== undefined ? { referenceFrameMs } : {}),
          },
          options,
        );
        return;
      }
      if (gate.status === "at-start") startPlan = gate.plan;
    }
    rerunOnSlot(cardId, slot, sequenceId, startPlan, reverse);
  };

  const handleNextSequence = (cardId: string) => {
    const card = cards.find((entry) => entry.id === cardId);
    if (!card || !isExecCardAtRest(card) || card.sequenceId === undefined || poseDialog) return;
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
    // 下一条槽即使已准备也要重新准备：释放上一条会把它的准备一起停掉
    let startPlan: NearestStartPlan | null = null;
    if (authored) {
      const gate = evaluateStartGate({
        sequence: authored,
        objects: document.setup.controlledObjects,
        motors: document.setup.motors,
        telemetryByObjectId,
        ...slot.runOptions,
      });
      if (needsEntryDialog(gate, "next")) {
        openEntryDialog(
          { intent: "next", slotIndex: slot.index, cardId, sequenceId, reverse: slot.runOptions.reverse },
          slot.runOptions,
        );
        return;
      }
      if (gate.status === "at-start") startPlan = gate.plan;
    }
    readyThenGoNext(cardId, slot, sequenceId, startPlan);
  };

  /** 推子槽 Ready：按槽的就近 / 反向开关判断，需要时先弹接入点选择 */
  const readyFromSlot = (slot: FaderSlotState, sequenceId: number) => {
    if (poseDialog) return;
    const document = currentProject?.document;
    if (!document) return;
    const authored = document.motion.actionSequences.find((entry) => entry.id === sequenceId);
    let startPlan: NearestStartPlan | null = null;
    if (authored) {
      const gate = evaluateStartGate({
        sequence: authored,
        objects: document.setup.controlledObjects,
        motors: document.setup.motors,
        telemetryByObjectId,
        ...slot.runOptions,
      });
      if (needsEntryDialog(gate, "fader")) {
        openEntryDialog(
          { intent: "fader", slotIndex: slot.index, cardId: null, sequenceId, reverse: slot.runOptions.reverse },
          slot.runOptions,
        );
        return;
      }
      if (gate.status === "at-start") startPlan = gate.plan;
    }
    beginReady(slot.index, sequenceId, startPlan, slotReadyOptions(slot));
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
        setPreparedPoseAlert({ slotIndex, sequenceId });
        return;
      }
      setSlotBusy(slotIndex, true);
      void (async () => {
        try {
          await goSlot(slot, sequenceId, slot.startPlan, slot.maxSpeedPercent);
        } finally {
          setSlotBusy(slotIndex, false);
        }
      })();
      return;
    }

    readyFromSlot(slot, sequenceId);
  };

  /** 准备后设备被移动过：撤掉准备，按现在的位置重新走 Ready（需要时弹接入点选择） */
  const handleReprepare = (alert: PreparedPoseAlert) => {
    setPreparedPoseAlert(null);
    clearSlotReady(alert.slotIndex);
    const slot = faderSlots[alert.slotIndex];
    if (!slot || slot.isBusy || slot.sequence?.id !== alert.sequenceId) return;
    readyFromSlot(slot, alert.sequenceId);
  };

  const triggerSequenceRef = useRef(handleTriggerSequence);
  triggerSequenceRef.current = handleTriggerSequence;
  const handleStableTriggerSequence = useCallback(
    (slotIndex: number, sequenceId: number) => triggerSequenceRef.current(slotIndex, sequenceId),
    [],
  );

  return (
    <section className={cn("flex min-h-0 overflow-hidden rounded-lg bg-card", className)}>
      <div className="flex h-full w-[330px] shrink-0 flex-col">
        <ExecCards
          onNextSequence={handleNextSequence}
          onContinue={(cardId) => handleRerun(cardId, "continue")}
          onReverseBack={(cardId) => handleRerun(cardId, "reverse-back")}
        />
      </div>
      <div className="min-w-0 flex-1">
        <Executors onTriggerSequence={handleStableTriggerSequence} />
      </div>
      <StartEntryDialog
        request={entryRequest}
        onCancel={() => setPoseDialog(null)}
        onConfirm={handleConfirmEntry}
      />
      {preparedPoseAlert !== null ? (
        <PreparedPoseDialog
          open
          onCancelReady={() => {
            clearSlotReady(preparedPoseAlert.slotIndex);
            setPreparedPoseAlert(null);
          }}
          onReprepare={() => handleReprepare(preparedPoseAlert)}
        />
      ) : null}
    </section>
  );
};
