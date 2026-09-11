import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { PROGRAM_SLOTS_PER_PAGE } from "../components/program-panel/program-data";
import type { PageItems } from "./program-context";
import type { ActionSequence } from "../components/program-panel/program-data";

export type FaderSlotState = {
  index: number;
  label: string;
  sequence: ActionSequence | null;
  faderValue: number;
  isRunning: boolean;
};

type ExecutorSlotsValue = {
  faderSlots: FaderSlotState[];
  setFaderValue: (index: number, value: number) => void;
  setSlotRunning: (index: number, running: boolean) => void;
};

const ExecutorSlotsContext = createContext<ExecutorSlotsValue | null>(null);

type ExecutorSlotsProviderProps = {
  children: ReactNode;
  pageItems: PageItems;
};

export const ExecutorSlotsProvider = ({ children, pageItems }: ExecutorSlotsProviderProps) => {
  const [faderValues, setFaderValues] = useState<Record<number, number>>({});
  const [runningFaders, setRunningFaders] = useState<Set<number>>(new Set());

  const faderSlots = useMemo<FaderSlotState[]>(
    () =>
      Array.from({ length: PROGRAM_SLOTS_PER_PAGE }, (_, idx) => {
        const item = pageItems.sequences[idx];
        return {
          index: idx,
          label: `F${idx + 1}`,
          sequence: item?.kind === "sequence" ? item.sequence : null,
          faderValue: faderValues[idx] ?? 100,
          isRunning: runningFaders.has(idx),
        };
      }),
    [pageItems.sequences, faderValues, runningFaders]
  );

  const setFaderValue = useCallback((index: number, value: number) => {
    setFaderValues((current) => ({ ...current, [index]: value }));
  }, []);

  const setSlotRunning = useCallback((index: number, running: boolean) => {
    setRunningFaders((current) => {
      const next = new Set(current);
      if (running) next.add(index);
      else next.delete(index);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ faderSlots, setFaderValue, setSlotRunning }),
    [faderSlots, setFaderValue, setSlotRunning]
  );

  return <ExecutorSlotsContext.Provider value={value}>{children}</ExecutorSlotsContext.Provider>;
};

export const useExecutorSlots = (): ExecutorSlotsValue => {
  const value = useContext(ExecutorSlotsContext);
  if (!value) throw new Error("useExecutorSlots must be used inside ExecutorSlotsProvider");
  return value;
};
