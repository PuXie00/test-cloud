import type { TrajectoryMode } from "@shared/action-sequence";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { advanceRunningCards } from "./advance-running-cards";
import {
  getSequenceTransport,
  stopSequence,
  type SequenceRuntimeHandle,
} from "./sequence-execution";

export type ExecCardSource =
  | { kind: "fader"; slotIndex: number }
  | { kind: "program" }
  | { kind: "external" }
  | { kind: "manual" };

export type ExecCardKind = "sequence";
export type ExecCardStatus = "running" | "paused" | "stopped" | "completed" | "error";

export type ExecCard = {
  id: string;
  kind: ExecCardKind;
  name: string;
  source: ExecCardSource;
  durationMs: number | null;
  elapsedMs: number;
  speedPercent: number;
  status: ExecCardStatus;
  startedAt: number;
  emergencyStopped: boolean;
  sequenceId?: number;
  sequenceHandle?: SequenceRuntimeHandle;
  trajectoryMode?: TrajectoryMode;
};

type ExecCardsContextValue = {
  cards: ExecCard[];
  launch: (input: {
    kind: ExecCardKind;
    name: string;
    durationMs: number | null;
    source: ExecCardSource;
    speedPercent?: number;
    sequenceId?: number;
    sequenceHandle?: SequenceRuntimeHandle;
    trajectoryMode?: TrajectoryMode;
  }) => string;
  pause: (id: string) => void;
  resume: (id: string) => void;
  stop: (id: string) => void;
  restart: (id: string) => void;
  skipNext: (id: string) => void;
  setSpeed: (id: string, percent: number) => void;
  emergencyStopAll: () => void;
  close: (id: string) => void;
};

const ExecCardsContext = createContext<ExecCardsContextValue | null>(null);

type ExecCardsProviderProps = { children: ReactNode };

const hasActiveRunningCard = (cards: ExecCard[]) =>
  cards.some((card) => card.status === "running" && !card.emergencyStopped);

export const ExecCardsProvider = ({ children }: ExecCardsProviderProps) => {
  const [cards, setCards] = useState<ExecCard[]>([]);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastTickRef.current = 0;
  }, []);

  const ensureLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    if (!hasActiveRunningCard(cardsRef.current)) return;

    const tick = (now: number) => {
      rafRef.current = null;

      if (!hasActiveRunningCard(cardsRef.current)) {
        stopLoop();
        return;
      }

      const delta = lastTickRef.current ? now - lastTickRef.current : 0;
      lastTickRef.current = now;

      const next = advanceRunningCards(cardsRef.current, delta);
      if (next) {
        setCards(next);
      }

      if (hasActiveRunningCard(next ?? cardsRef.current)) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        stopLoop();
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [stopLoop]);

  useEffect(() => {
    if (hasActiveRunningCard(cards)) {
      ensureLoop();
      return;
    }
    stopLoop();
  }, [cards, ensureLoop, stopLoop]);

  useEffect(() => () => stopLoop(), [stopLoop]);

  // auto-remove completed cards after 3s
  useEffect(() => {
    const timers = cards
      .filter((card) => card.status === "completed")
      .map((card) =>
        setTimeout(() => {
          setCards((current) => current.filter((entry) => entry.id !== card.id));
        }, 3000),
      );
    return () => timers.forEach(clearTimeout);
  }, [cards]);

  const launch = useCallback<ExecCardsContextValue["launch"]>(
    ({ kind, name, durationMs, source, speedPercent = 100, sequenceId, sequenceHandle, trajectoryMode }) => {
      const id = `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      setCards((current) => [
        {
          id,
          kind,
          name,
          source,
          durationMs,
          elapsedMs: 0,
          speedPercent,
          status: "running",
          startedAt: Date.now(),
          emergencyStopped: false,
          ...(sequenceId !== undefined ? { sequenceId } : {}),
          ...(sequenceHandle ? { sequenceHandle } : {}),
          ...(trajectoryMode !== undefined ? { trajectoryMode } : {}),
        },
        ...current,
      ]);
      return id;
    },
    [],
  );

  const pause = useCallback((id: string) => {
    setCards((current) =>
      current.map((card) => (card.id === id && card.status === "running" ? { ...card, status: "paused" } : card)),
    );
  }, []);

  const resume = useCallback((id: string) => {
    setCards((current) =>
      current.map((card) =>
        card.id === id && (card.status === "paused" || card.status === "stopped")
          ? { ...card, status: "running" as const }
          : card,
      ),
    );
  }, []);

  const stop = useCallback((id: string) => {
    const card = cardsRef.current.find((entry) => entry.id === id);
    if (card?.sequenceHandle) {
      void stopSequence(
        {
          actionId: card.sequenceHandle.actionId,
          trajectoryMode: card.trajectoryMode === true,
        },
        getSequenceTransport(),
      ).catch(() => undefined);
    }
    setCards((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, status: "stopped" as const } : entry)),
    );
  }, []);

  const restart = useCallback((id: string) => {
    setCards((current) =>
      current.map((card) => (card.id === id ? { ...card, status: "running" as const } : card)),
    );
  }, []);

  const skipNext = useCallback(() => {}, []);

  const setSpeed = useCallback((id: string, percent: number) => {
    setCards((current) =>
      current.map((card) => (card.id === id ? { ...card, speedPercent: percent } : card)),
    );
  }, []);

  const emergencyStopAll = useCallback(() => {
    const handles = cardsRef.current.flatMap((card) =>
      card.sequenceHandle
        ? [
            {
              actionId: card.sequenceHandle.actionId,
              trajectoryMode: card.trajectoryMode === true,
            },
          ]
        : [],
    );
    setCards((current) =>
      current.map((card) => ({ ...card, emergencyStopped: true, status: "error" })),
    );
    const transport = getSequenceTransport();
    for (const handle of handles) {
      void stopSequence(handle, transport).catch(() => undefined);
    }
  }, []);

  const close = useCallback((id: string) => {
    const card = cardsRef.current.find((entry) => entry.id === id);
    if (
      card?.sequenceHandle &&
      !card.emergencyStopped &&
      (card.status === "running" || card.status === "paused" || card.status === "stopped")
    ) {
      void stopSequence(
        {
          actionId: card.sequenceHandle.actionId,
          trajectoryMode: card.trajectoryMode === true,
        },
        getSequenceTransport(),
      ).catch(() => undefined);
    }
    setCards((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const value = useMemo(
    () => ({ cards, launch, pause, resume, stop, restart, skipNext, setSpeed, emergencyStopAll, close }),
    [cards, launch, pause, resume, stop, restart, skipNext, setSpeed, emergencyStopAll, close],
  );

  return <ExecCardsContext.Provider value={value}>{children}</ExecCardsContext.Provider>;
};

export const useExecCards = (): ExecCardsContextValue => {
  const value = useContext(ExecCardsContext);
  if (!value) throw new Error("useExecCards must be used inside ExecCardsProvider");
  return value;
};
