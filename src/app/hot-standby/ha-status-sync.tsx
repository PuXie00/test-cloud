import { useEffect, useSyncExternalStore } from "react";
import { useRunningActionIds } from "@/app/pages/console/hooks/action-run";
import { useGoReady } from "@/app/pages/console/hooks/go-ready-provider";
import { useExecCards, type ExecCardStatus } from "@/app/pages/console/hooks/use-exec-cards";
import { useProject } from "@/app/project/use-project";
import { sequenceObjectIds } from "./ha-busy";
import { useHaProjectSync } from "./ha-project-sync-provider";
import { getManualHoldIds, subscribeManualHolds } from "./manual-hold-registry";

/** 还在跑的任务卡（停下、结束、出错的不算在用） */
const ACTIVE_CARD_STATUSES: ReadonlySet<ExecCardStatus> = new Set(["running", "paused", "stopping"]);

/**
 * 主备热备：算本机在用的物体和动作，交给同步引擎发给另一台（方案 6.4、6.6）：
 * 在跑的任务卡和正在运行的动作里的物体、位姿 GO 里的物体、按住点动的物体和电机。
 */
export const HaStatusSync = () => {
  const { setLocalStatus } = useHaProjectSync();
  const { cards } = useExecCards();
  const running = useRunningActionIds();
  const { state: goState } = useGoReady();
  const holds = useSyncExternalStore(subscribeManualHolds, getManualHoldIds);
  const { currentProject } = useProject();
  const sequences = currentProject?.document?.motion.actionSequences;

  useEffect(() => {
    const sequenceIds = new Set<number>(running);
    for (const card of cards) {
      if (card.sequenceId !== undefined && ACTIVE_CARD_STATUSES.has(card.status)) {
        sequenceIds.add(card.sequenceId);
      }
    }
    const deviceIds = new Set<number>(holds);
    for (const id of sequenceIds) {
      for (const objectId of sequenceObjectIds(sequences?.find((sequence) => sequence.id === id))) {
        deviceIds.add(objectId);
      }
    }
    if (goState.phase !== "idle") {
      for (const entry of goState.entries) {
        const id = Number(entry.objectId);
        if (Number.isInteger(id)) deviceIds.add(id);
      }
    }
    setLocalStatus({ deviceIds: [...deviceIds], sequenceIds: [...sequenceIds] });
  }, [cards, running, goState, holds, sequences, setLocalStatus]);

  return null;
};
