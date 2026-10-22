import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { PROGRAM_SLOTS_PER_PAGE } from "../components/program-panel/program-data";
import type { PageItems } from "./program-context";
import type { PreparedPoses } from "@/app/project/action-sequence/initial-pose-gate";
import type { NearestStartPlan } from "@/app/project/action-sequence/nearest-start";
import {
  resolveSlotRunOptions,
  type SlotRunOptions,
} from "@/app/project/program-item-run-options";
import type { ActionSequence } from "../components/program-panel/program-data";

export { DEFAULT_SLOT_RUN_OPTIONS, type SlotRunOptions } from "@/app/project/program-item-run-options";

export type FaderSlotPhase = "idle" | "ready" | "running";

export type FaderSlotState = {
  index: number;
  label: string;
  sequence: ActionSequence | null;
  faderValue: number;
  phase: FaderSlotPhase;
  isBusy: boolean;
  runOptions: SlotRunOptions;
  startPlan: NearestStartPlan | null;
  preparedPoses: PreparedPoses | null;
  /** 调速范围给出的推子上限（百分比）；准备后到运行中有效，null 为不限 */
  maxSpeedPercent: number | null;
};

type SlotReadyRecord = {
  sequenceId: number;
  fingerprint: string;
  startPlan: NearestStartPlan | null;
  preparedPoses: PreparedPoses;
};

/** 准备时算出的调速上限；GO 后准备记录清掉了，运行中仍按它封顶 */
type SlotSpeedCap = { sequenceId: number; maxPercent: number | null };

type ExecutorSlotsValue = {
  faderSlots: FaderSlotState[];
  setFaderValue: (index: number, value: number) => void;
  setSlotRunning: (index: number, running: boolean) => void;
  setSlotBusy: (index: number, busy: boolean) => void;
  setSlotRunOptions: (index: number, patch: Partial<SlotRunOptions>) => void;
  markSlotReady: (
    index: number,
    sequenceId: number,
    fingerprint: string,
    startPlan: NearestStartPlan | null,
    preparedPoses: PreparedPoses,
    maxSpeedPercent?: number | null,
  ) => void;
  clearSlotReady: (index: number) => void;
};

const ExecutorSlotsContext = createContext<ExecutorSlotsValue | null>(null);

type ExecutorSlotsProviderProps = {
  children: ReactNode;
  pageItems: PageItems;
  sequenceFingerprints: Readonly<Record<number, string>>;
  /** 运行选项存于节目条目；改动交给节目写回工程 */
  onSlotRunOptionsChange?: (index: number, runOptions: SlotRunOptions) => void;
};

/** 推子值不超过调速上限 */
export const capFaderValue = (value: number, maxPercent: number | null): number =>
  maxPercent === null ? value : Math.min(value, maxPercent);

export const deriveFaderSlotPhase = (args: {
  sequenceId: number | null;
  fingerprint: string | null;
  ready: SlotReadyRecord | null;
  isRunning: boolean;
}): FaderSlotPhase => {
  if (args.isRunning) return "running";
  if (
    args.ready &&
    args.sequenceId !== null &&
    args.fingerprint !== null &&
    args.ready.sequenceId === args.sequenceId &&
    args.ready.fingerprint === args.fingerprint
  ) {
    return "ready";
  }
  return "idle";
};

export const ExecutorSlotsProvider = ({
  children,
  pageItems,
  sequenceFingerprints,
  onSlotRunOptionsChange,
}: ExecutorSlotsProviderProps) => {
  const [faderValues, setFaderValues] = useState<Record<number, number>>({});
  const [runningFaders, setRunningFaders] = useState<Set<number>>(new Set());
  const [busyBySlot, setBusyBySlot] = useState<Record<number, number>>({});
  const [readyBySlot, setReadyBySlot] = useState<Record<number, SlotReadyRecord>>({});
  const [speedCapBySlot, setSpeedCapBySlot] = useState<Record<number, SlotSpeedCap>>({});

  const faderSlots = useMemo<FaderSlotState[]>(
    () =>
      Array.from({ length: PROGRAM_SLOTS_PER_PAGE }, (_, idx) => {
        const item = pageItems.sequences[idx];
        const sequence = item?.kind === "sequence" ? item.sequence : null;
        const fingerprint = sequence ? sequenceFingerprints[sequence.id] ?? null : null;
        const ready = readyBySlot[idx] ?? null;
        const isRunning = runningFaders.has(idx);
        const phase = deriveFaderSlotPhase({
          sequenceId: sequence?.id ?? null,
          fingerprint,
          ready,
          isRunning,
        });
        const cap = speedCapBySlot[idx];
        const maxSpeedPercent =
          phase !== "idle" && cap && cap.sequenceId === sequence?.id ? cap.maxPercent : null;
        return {
          index: idx,
          label: `F${idx + 1}`,
          sequence,
          faderValue: capFaderValue(faderValues[idx] ?? 100, maxSpeedPercent),
          phase,
          isBusy: sequence !== null && busyBySlot[idx] === sequence.id,
          runOptions: resolveSlotRunOptions(item?.runOptions),
          startPlan: phase === "ready" && ready ? ready.startPlan : null,
          preparedPoses: phase === "ready" && ready ? ready.preparedPoses : null,
          maxSpeedPercent,
        };
      }),
    [
      pageItems.sequences,
      sequenceFingerprints,
      faderValues,
      runningFaders,
      busyBySlot,
      readyBySlot,
      speedCapBySlot,
    ],
  );

  const setFaderValue = useCallback((index: number, value: number) => {
    setFaderValues((current) => ({ ...current, [index]: value }));
  }, []);

  const setSlotRunning = useCallback((index: number, running: boolean) => {
    setRunningFaders((current) => {
      if (current.has(index) === running) return current;
      const next = new Set(current);
      if (running) next.add(index);
      else next.delete(index);
      return next;
    });
  }, []);

  const setSlotBusy = useCallback(
    (index: number, busy: boolean) => {
      setBusyBySlot((current) => {
        if (!busy) {
          if (!(index in current)) return current;
          const next = { ...current };
          delete next[index];
          return next;
        }
        const sequenceId = pageItems.sequences[index]?.sequence.id;
        if (sequenceId === undefined || current[index] === sequenceId) return current;
        return { ...current, [index]: sequenceId };
      });
    },
    [pageItems.sequences],
  );

  const setSlotRunOptions = useCallback(
    (index: number, patch: Partial<SlotRunOptions>) => {
      const item = pageItems.sequences[index];
      if (!item) return;
      onSlotRunOptionsChange?.(index, { ...resolveSlotRunOptions(item.runOptions), ...patch });
    },
    [pageItems.sequences, onSlotRunOptionsChange],
  );

  const markSlotReady = useCallback(
    (
      index: number,
      sequenceId: number,
      fingerprint: string,
      startPlan: NearestStartPlan | null,
      preparedPoses: PreparedPoses,
      maxSpeedPercent: number | null = null,
    ) => {
      setReadyBySlot((current) => ({
        ...current,
        [index]: { sequenceId, fingerprint, startPlan, preparedPoses },
      }));
      setSpeedCapBySlot((current) => ({
        ...current,
        [index]: { sequenceId, maxPercent: maxSpeedPercent },
      }));
      // 推子已推过上限时落到上限，运行结束后也不会跳回原值
      if (maxSpeedPercent !== null) {
        setFaderValues((current) => {
          const value = current[index] ?? 100;
          return value > maxSpeedPercent ? { ...current, [index]: maxSpeedPercent } : current;
        });
      }
    },
    [],
  );

  const clearSlotReady = useCallback((index: number) => {
    setReadyBySlot((current) => {
      if (!(index in current)) return current;
      const next = { ...current };
      delete next[index];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      faderSlots,
      setFaderValue,
      setSlotRunning,
      setSlotBusy,
      setSlotRunOptions,
      markSlotReady,
      clearSlotReady,
    }),
    [
      faderSlots,
      setFaderValue,
      setSlotRunning,
      setSlotBusy,
      setSlotRunOptions,
      markSlotReady,
      clearSlotReady,
    ],
  );

  return <ExecutorSlotsContext.Provider value={value}>{children}</ExecutorSlotsContext.Provider>;
};

export const useExecutorSlots = (): ExecutorSlotsValue => {
  const value = useContext(ExecutorSlotsContext);
  if (!value) throw new Error("useExecutorSlots must be used inside ExecutorSlotsProvider");
  return value;
};
