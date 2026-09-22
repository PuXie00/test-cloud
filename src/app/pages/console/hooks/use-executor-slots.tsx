import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { PROGRAM_SLOTS_PER_PAGE } from "../components/program-panel/program-data";
import type { PageItems } from "./program-context";
import type { InitialTransitionPlan } from "@/app/project/action-sequence/initial-transition-planner";
import type { ActionSequence } from "../components/program-panel/program-data";

export type FaderSlotPhase = "idle" | "ready" | "running";

export type FaderSlotState = {
  index: number;
  label: string;
  sequence: ActionSequence | null;
  faderValue: number;
  phase: FaderSlotPhase;
  isBusy: boolean;
  initialTransition: InitialTransitionPlan | null;
};

type SlotReadyRecord = {
  sequenceId: number;
  fingerprint: string;
  initialTransition: InitialTransitionPlan | null;
};

type ExecutorSlotsValue = {
  faderSlots: FaderSlotState[];
  setFaderValue: (index: number, value: number) => void;
  setSlotRunning: (index: number, running: boolean) => void;
  setSlotBusy: (index: number, busy: boolean) => void;
  markSlotReady: (
    index: number,
    sequenceId: number,
    fingerprint: string,
    initialTransition: InitialTransitionPlan | null,
  ) => void;
  clearSlotReady: (index: number) => void;
};

const ExecutorSlotsContext = createContext<ExecutorSlotsValue | null>(null);

type ExecutorSlotsProviderProps = {
  children: ReactNode;
  pageItems: PageItems;
  sequenceFingerprints: Readonly<Record<number, string>>;
};

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
}: ExecutorSlotsProviderProps) => {
  const [faderValues, setFaderValues] = useState<Record<number, number>>({});
  const [runningFaders, setRunningFaders] = useState<Set<number>>(new Set());
  const [busyBySlot, setBusyBySlot] = useState<Record<number, number>>({});
  const [readyBySlot, setReadyBySlot] = useState<Record<number, SlotReadyRecord>>({});

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
        return {
          index: idx,
          label: `F${idx + 1}`,
          sequence,
          faderValue: faderValues[idx] ?? 100,
          phase,
          isBusy: sequence !== null && busyBySlot[idx] === sequence.id,
          initialTransition: phase === "ready" && ready ? ready.initialTransition : null,
        };
      }),
    [pageItems.sequences, sequenceFingerprints, faderValues, runningFaders, busyBySlot, readyBySlot],
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

  const markSlotReady = useCallback(
    (
      index: number,
      sequenceId: number,
      fingerprint: string,
      initialTransition: InitialTransitionPlan | null,
    ) => {
      setReadyBySlot((current) => ({
        ...current,
        [index]: { sequenceId, fingerprint, initialTransition },
      }));
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
      markSlotReady,
      clearSlotReady,
    }),
    [faderSlots, setFaderValue, setSlotRunning, setSlotBusy, markSlotReady, clearSlotReady],
  );

  return <ExecutorSlotsContext.Provider value={value}>{children}</ExecutorSlotsContext.Provider>;
};

export const useExecutorSlots = (): ExecutorSlotsValue => {
  const value = useContext(ExecutorSlotsContext);
  if (!value) throw new Error("useExecutorSlots must be used inside ExecutorSlotsProvider");
  return value;
};
