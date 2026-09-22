import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { PROGRAM_SLOTS_PER_PAGE } from "../components/program-panel/program-data";
import type { PageItems } from "./program-context";
import type { ActionSequence } from "../components/program-panel/program-data";

export type FaderSlotPhase = "idle" | "ready" | "running";

export type FaderSlotState = {
  index: number;
  label: string;
  sequence: ActionSequence | null;
  faderValue: number;
  phase: FaderSlotPhase;
  isBusy: boolean;
  safetyGroup: boolean;
  nearestStart: boolean;
};

type SlotReadyRecord = {
  sequenceId: number;
  fingerprint: string;
};

type ExecutorSlotsValue = {
  faderSlots: FaderSlotState[];
  setFaderValue: (index: number, value: number) => void;
  setSlotRunning: (index: number, running: boolean) => void;
  setSlotBusy: (index: number, busy: boolean) => void;
  markSlotReady: (index: number, sequenceId: number, fingerprint: string) => void;
  clearSlotReady: (index: number) => void;
  setSafetyGroup: (index: number, enabled: boolean) => void;
  setNearestStart: (index: number, enabled: boolean) => void;
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
  const [safetyGroupBySlot, setSafetyGroupBySlot] = useState<Record<number, boolean>>({});
  const [nearestStartBySlot, setNearestStartBySlot] = useState<Record<number, boolean>>({});

  const faderSlots = useMemo<FaderSlotState[]>(
    () =>
      Array.from({ length: PROGRAM_SLOTS_PER_PAGE }, (_, idx) => {
        const item = pageItems.sequences[idx];
        const sequence = item?.kind === "sequence" ? item.sequence : null;
        const fingerprint = sequence ? sequenceFingerprints[sequence.id] ?? null : null;
        const ready = readyBySlot[idx] ?? null;
        const isRunning = runningFaders.has(idx);
        return {
          index: idx,
          label: `F${idx + 1}`,
          sequence,
          faderValue: faderValues[idx] ?? 100,
          phase: deriveFaderSlotPhase({
            sequenceId: sequence?.id ?? null,
            fingerprint,
            ready,
            isRunning,
          }),
          isBusy: sequence !== null && busyBySlot[idx] === sequence.id,
          safetyGroup: safetyGroupBySlot[idx] === true,
          nearestStart: nearestStartBySlot[idx] === true,
        };
      }),
    [
      pageItems.sequences,
      sequenceFingerprints,
      faderValues,
      runningFaders,
      busyBySlot,
      readyBySlot,
      safetyGroupBySlot,
      nearestStartBySlot,
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

  const markSlotReady = useCallback((index: number, sequenceId: number, fingerprint: string) => {
    setReadyBySlot((current) => ({ ...current, [index]: { sequenceId, fingerprint } }));
  }, []);

  const clearSlotReady = useCallback((index: number) => {
    setReadyBySlot((current) => {
      if (!(index in current)) return current;
      const next = { ...current };
      delete next[index];
      return next;
    });
  }, []);

  const setSafetyGroup = useCallback((index: number, enabled: boolean) => {
    setSafetyGroupBySlot((current) => {
      if ((current[index] === true) === enabled) return current;
      return { ...current, [index]: enabled };
    });
  }, []);

  const setNearestStart = useCallback((index: number, enabled: boolean) => {
    setNearestStartBySlot((current) => {
      if ((current[index] === true) === enabled) return current;
      return { ...current, [index]: enabled };
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
      setSafetyGroup,
      setNearestStart,
    }),
    [
      faderSlots,
      setFaderValue,
      setSlotRunning,
      setSlotBusy,
      markSlotReady,
      clearSlotReady,
      setSafetyGroup,
      setNearestStart,
    ],
  );

  return <ExecutorSlotsContext.Provider value={value}>{children}</ExecutorSlotsContext.Provider>;
};

export const useExecutorSlots = (): ExecutorSlotsValue => {
  const value = useContext(ExecutorSlotsContext);
  if (!value) throw new Error("useExecutorSlots must be used inside ExecutorSlotsProvider");
  return value;
};
