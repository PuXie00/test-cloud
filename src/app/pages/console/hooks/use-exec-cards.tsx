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
import {
  getLocalSequenceTransport,
  stopSequence,
  type SequenceRuntimeHandle,
} from "./sequence-execution";

export type ExecCardSource =
  | { kind: "button"; slotIndex: number }
  | { kind: "fader"; slotIndex: number }
  | { kind: "program" }
  | { kind: "external" }
  | { kind: "manual" };

export type ExecCardKind = "cue" | "sequence";
export type ExecCardStatus = "running" | "paused" | "completed" | "error";

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
  sequenceHandle?: SequenceRuntimeHandle;
};

type ExecCardsContextValue = {
  cards: ExecCard[];
  launch: (input: {
    kind: ExecCardKind;
    name: string;
    durationMs: number | null;
    source: ExecCardSource;
    speedPercent?: number;
    sequenceHandle?: SequenceRuntimeHandle;
  }) => string;
  pause: (id: string) => void;
  resume: (id: string) => void;
  stop: (id: string) => void;
  skipNext: (id: string) => void;
  setSpeed: (id: string, percent: number) => void;
  emergencyStopAll: () => void;
  close: (id: string) => void;
};

const ExecCardsContext = createContext<ExecCardsContextValue | null>(null);

type ExecCardsProviderProps = { children: ReactNode };

const hasActiveRunningCard = (cards: ExecCard[]) =>
  cards.some((card) => card.status === "running" && !card.emergencyStopped);

export const advanceRunningCards = (cards: ExecCard[], delta: number): ExecCard[] | null => {
  let changed = false;
  const next = cards.map((card) => {
    if (card.status !== "running" || card.emergencyStopped) return card;
    if (card.durationMs === null) {
      const elapsedMs = card.elapsedMs + delta;
      changed = true;
      return { ...card, elapsedMs };
    }

    const advance = delta * (card.speedPercent / 100);
    const elapsedMs = Math.min(card.durationMs, card.elapsedMs + advance);
    const status: ExecCardStatus =
      elapsedMs >= card.durationMs ? "completed" : "running";
    if (elapsedMs === card.elapsedMs && status === card.status) return card;
    changed = true;
    return { ...card, elapsedMs, status };
  });
  return changed ? next : null;
};

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
    ({ kind, name, durationMs, source, speedPercent = 100, sequenceHandle }) => {
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
          ...(sequenceHandle ? { sequenceHandle } : {}),
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
      current.map((card) => (card.id === id && card.status === "paused" ? { ...card, status: "running" } : card)),
    );
  }, []);

  const stop = useCallback((id: string) => {
    const card = cardsRef.current.find((entry) => entry.id === id);
    setCards((current) => current.filter((entry) => entry.id !== id));
    if (!card?.sequenceHandle) return;
    void stopSequence(card.sequenceHandle, getLocalSequenceTransport()).catch(() => undefined);
  }, []);

  const skipNext = useCallback((id: string) => {
    const card = cardsRef.current.find((entry) => entry.id === id);
    if (card?.sequenceHandle) {
      void stopSequence(card.sequenceHandle, getLocalSequenceTransport()).catch(() => undefined);
    }
    setCards((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              elapsedMs: entry.durationMs ?? entry.elapsedMs,
              status: "completed",
            }
          : entry,
      ),
    );
  }, []);

  const setSpeed = useCallback((id: string, percent: number) => {
    setCards((current) =>
      current.map((card) => (card.id === id ? { ...card, speedPercent: percent } : card)),
    );
  }, []);

  const emergencyStopAll = useCallback(() => {
    const handles = cardsRef.current
      .map((card) => card.sequenceHandle)
      .filter((handle): handle is SequenceRuntimeHandle => handle !== undefined);
    setCards((current) =>
      current.map((card) => ({ ...card, emergencyStopped: true, status: "error" })),
    );
    const transport = getLocalSequenceTransport();
    for (const handle of handles) {
      void stopSequence(handle, transport).catch(() => undefined);
    }
  }, []);

  const close = useCallback((id: string) => {
    setCards((current) => current.filter((card) => card.id !== id));
  }, []);

  const value = useMemo(
    () => ({ cards, launch, pause, resume, stop, skipNext, setSpeed, emergencyStopAll, close }),
    [cards, launch, pause, resume, stop, skipNext, setSpeed, emergencyStopAll, close],
  );

  return <ExecCardsContext.Provider value={value}>{children}</ExecCardsContext.Provider>;
};

export const useExecCards = (): ExecCardsContextValue => {
  const value = useContext(ExecCardsContext);
  if (!value) throw new Error("useExecCards must be used inside ExecCardsProvider");
  return value;
};
