import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { PageItems } from "./program-context";
import {
  PROGRAM_SLOTS_PER_PAGE,
  type ChapterItem,
  type PositionCue,
  type ActionSequence,
} from "../components/program-panel/program-data";

export type ButtonSlotState = {
  index: number;
  label: string;
  cue: PositionCue | null;
  isRunning: boolean;
};

export type FaderSlotState = {
  index: number;
  label: string;
  sequence: ActionSequence | null;
  faderValue: number;
  isRunning: boolean;
};

type ExecutorSlotsValue = {
  buttonSlots: ButtonSlotState[];
  faderSlots: FaderSlotState[];
  setFaderValue: (index: number, value: number) => void;
  setSlotRunning: (kind: "button" | "fader", index: number, running: boolean) => void;
};

const ExecutorSlotsContext = createContext<ExecutorSlotsValue | null>(null);

type ExecutorSlotsProviderProps = {
  children: ReactNode;
  pageItems: PageItems;
};

const BUTTON_SLOT_COUNT = 8;

export const ExecutorSlotsProvider = ({ children, pageItems }: ExecutorSlotsProviderProps) => {
  const [faderValues, setFaderValues] = useState<Record<number, number>>({});
  const [runningButtons, setRunningButtons] = useState<Set<number>>(new Set());
  const [runningFaders, setRunningFaders] = useState<Set<number>>(new Set());

  const buttonSlots = useMemo<ButtonSlotState[]>(
    () =>
      Array.from({ length: BUTTON_SLOT_COUNT }, (_, idx) => ({
        index: idx,
        label: `B${idx + 1}`,
        cue: null,
        isRunning: runningButtons.has(idx),
      })),
    [runningButtons]
  );

  const faderSlots = useMemo<FaderSlotState[]>(
    () =>
      Array.from({ length: PROGRAM_SLOTS_PER_PAGE }, (_, idx) => {
        const item = pageItems.sequences[idx] as ChapterItem | undefined;
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

  const setSlotRunning = useCallback(
    (kind: "button" | "fader", index: number, running: boolean) => {
      const updater = kind === "button" ? setRunningButtons : setRunningFaders;
      updater((current) => {
        const next = new Set(current);
        if (running) next.add(index);
        else next.delete(index);
        return next;
      });
    },
    []
  );

  const value = useMemo(
    () => ({ buttonSlots, faderSlots, setFaderValue, setSlotRunning }),
    [buttonSlots, faderSlots, setFaderValue, setSlotRunning]
  );

  return <ExecutorSlotsContext.Provider value={value}>{children}</ExecutorSlotsContext.Provider>;
};

export const useExecutorSlots = (): ExecutorSlotsValue => {
  const value = useContext(ExecutorSlotsContext);
  if (!value) throw new Error("useExecutorSlots must be used inside ExecutorSlotsProvider");
  return value;
};
