import { useCallback, useRef } from "react";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import { sequenceObjectIds } from "@/app/project/action-sequence/sequence-object-ids";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import type { ProjectDocument } from "@/app/project/project-document-types";
import { useProject } from "@/app/project/use-project";
import { fallbackActionCardSeed, type ActionCardSeed } from "./exec-card-run-status";
import { useExecutorSlots, type FaderSlotState } from "./use-executor-slots";

/** 序列单次时长（ms）；序列无法解析时为 undefined */
export const sequenceTotalMs = (sequence: ActionSequenceConfig | undefined): number | undefined => {
  if (!sequence) return undefined;
  try {
    return resolveActionSequence(sequence).totalMs;
  } catch {
    return undefined;
  }
};

/**
 * PLC 上报里没有的信息从序列和执行槽取：名称、时长、强制轨迹来自序列（actionId 即序列 id），
 * 来源、速度比例、运行方向来自挂着这条序列的执行槽。
 */
export const buildActionCardSeed = (
  actionId: number,
  document: ProjectDocument | undefined,
  faderSlots: readonly FaderSlotState[],
): ActionCardSeed => {
  const sequence = document?.motion.actionSequences.find((entry) => entry.id === actionId);
  if (!sequence) return fallbackActionCardSeed(actionId);
  const slot = faderSlots.find((entry) => entry.sequence?.id === actionId);
  const totalMs = sequenceTotalMs(sequence);
  return {
    name: sequence.name,
    source: slot ? { kind: "fader", slotIndex: slot.index } : { kind: "external" },
    speedPercent: slot?.faderValue ?? 100,
    sequenceId: sequence.id,
    sequenceHandle: {
      actionId,
      deviceId: [...sequenceObjectIds(sequence)].sort((left, right) => left - right),
    },
    trajectoryMode: sequence.trajectoryMode,
    ...(totalMs !== undefined ? { totalMs } : {}),
    ...(slot ? { reverse: slot.runOptions.reverse } : {}),
  };
};

export const useActionCardSeed = (): ((actionId: number) => ActionCardSeed) => {
  const { currentProject } = useProject();
  const { faderSlots } = useExecutorSlots();
  const documentRef = useRef(currentProject?.document);
  documentRef.current = currentProject?.document;
  const faderSlotsRef = useRef(faderSlots);
  faderSlotsRef.current = faderSlots;
  return useCallback(
    (actionId) => buildActionCardSeed(actionId, documentRef.current, faderSlotsRef.current),
    [],
  );
};
