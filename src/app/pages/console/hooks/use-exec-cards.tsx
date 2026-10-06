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
  addLaunchedCard,
  applyActionRunReports,
  canCloseExecCard,
  execCardActionId,
  fallbackActionCardSeed,
  isExecCardInTransition,
  parseActionRunReports,
  settleSilentCards,
  type ActionCardSeed,
} from "./exec-card-run-status";
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
/** stopping：已下发停止，PLC 还在上报（减速中）；stopped：PLC 不再上报，真正停下来了 */
export type ExecCardStatus = "running" | "paused" | "stopping" | "stopped" | "completed" | "error";

/** PLC 最近一次上报的运行数据 */
export type ExecCardRun = {
  /** 1 过渡（回迹中），3 运行中 */
  state: number;
  /** 当前第几次循环 */
  loopCount: number;
  /** 设定循环次数；0 为无限循环 */
  loopCountSet: number;
  /** 轨迹运行到的位置（ms） */
  runTimeMs: number;
  reportedAt: number;
};

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
  /** 序列单次时长（ms），来自序列本身 */
  totalMs?: number;
  /** 反向运行，来自执行槽 */
  reverse?: boolean;
  /** PLC 还没上报过时为 undefined */
  run?: ExecCardRun;
  /** PLC 仍在上报这个动作 */
  plcActive?: boolean;
  stopRequestedAt?: number;
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
    totalMs?: number;
    reverse?: boolean;
  }) => string;
  pause: (id: string) => void;
  resume: (id: string) => void;
  stop: (id: string) => void;
  restart: (id: string) => void;
  skipNext: (id: string) => void;
  setSpeed: (id: string, percent: number) => void;
  emergencyStopAll: () => void;
  /** release=false：动作已经在别处释放过，只移除任务卡，不再下发停止 */
  close: (id: string, options?: { release?: boolean }) => void;
};

const ExecCardsContext = createContext<ExecCardsContextValue | null>(null);

type ExecCardsProviderProps = {
  children: ReactNode;
  /** PLC 上报了没有任务卡的动作时，从序列 / 执行槽取补建任务卡的信息 */
  resolveActionSeed?: (actionId: number) => ActionCardSeed;
};

const RUN_SETTLE_CHECK_MS = 100;

const isStoppable = (card: ExecCard) =>
  card.status === "running" || card.status === "stopping" || card.status === "paused";

const isTrulyStopped = (card: ExecCard) =>
  (card.status === "stopped" || card.status === "paused") && !card.plcActive;

const hasActiveRunningCard = (cards: ExecCard[]) =>
  cards.some((card) => card.status === "running" && !card.emergencyStopped);

export const ExecCardsProvider = ({
  children,
  resolveActionSeed = fallbackActionCardSeed,
}: ExecCardsProviderProps) => {
  const [cards, setCards] = useState<ExecCard[]>([]);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const resolveActionSeedRef = useRef(resolveActionSeed);
  resolveActionSeedRef.current = resolveActionSeed;
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.csocketApi : undefined;
    if (!api?.onReadActionRun) return;
    return api.onReadActionRun((msg) => {
      const reports = parseActionRunReports(msg);
      if (reports.length === 0) return;
      const now = Date.now();
      setCards(
        (current) =>
          applyActionRunReports(current, reports, now, (actionId) =>
            resolveActionSeedRef.current(actionId),
          ) ?? current,
      );
    });
  }, []);

  const hasUnsettledCard = cards.some((card) => card.plcActive || card.status === "stopping");
  useEffect(() => {
    if (!hasUnsettledCard) return;
    const timer = setInterval(() => {
      setCards((current) => settleSilentCards(current, Date.now()) ?? current);
    }, RUN_SETTLE_CHECK_MS);
    return () => clearInterval(timer);
  }, [hasUnsettledCard]);

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
    ({
      kind,
      name,
      durationMs,
      source,
      speedPercent = 100,
      sequenceId,
      sequenceHandle,
      trajectoryMode,
      totalMs,
      reverse,
    }) => {
      const launched: ExecCard = {
        id: `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
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
        ...(totalMs !== undefined ? { totalMs } : {}),
        ...(reverse !== undefined ? { reverse } : {}),
      };
      const actionId = execCardActionId(launched);
      const existing =
        actionId === undefined
          ? undefined
          : cardsRef.current.find((card) => execCardActionId(card) === actionId);
      setCards((current) => addLaunchedCard(current, launched));
      return existing?.id ?? launched.id;
    },
    [],
  );

  const pause = useCallback((id: string) => {
    setCards((current) =>
      current.map((card) => (card.id === id && card.status === "running" ? { ...card, status: "paused" } : card)),
    );
  }, []);

  /** 继续 / 重新：动作真正停下来之后才能操作。目前只改本地状态，清掉上一轮的上报，等 PLC 重新上报 */
  const resumeLocally = useCallback((id: string) => {
    setCards((current) =>
      current.map((card) => {
        if (card.id !== id || !isTrulyStopped(card)) return card;
        const { run: _staleRun, stopRequestedAt: _stopRequestedAt, ...rest } = card;
        return { ...rest, status: "running" as const };
      }),
    );
  }, []);

  const resume = resumeLocally;

  /** 下发停止后进入停止中；PLC 不再上报才算真正停下来（见 settleSilentCards） */
  const stop = useCallback((id: string) => {
    const card = cardsRef.current.find((entry) => entry.id === id);
    if (!card || !isStoppable(card)) return;
    if (card.sequenceHandle) {
      void stopSequence(
        {
          actionId: card.sequenceHandle.actionId,
          trajectoryMode: card.trajectoryMode === true,
          deviceId: card.sequenceHandle.deviceId ?? [],
        },
        getSequenceTransport(),
      ).catch(() => undefined);
    }
    const stopRequestedAt = Date.now();
    setCards((current) =>
      current.map((entry) =>
        entry.id === id && isStoppable(entry)
          ? { ...entry, status: "stopping" as const, stopRequestedAt }
          : entry,
      ),
    );
  }, []);

  const restart = resumeLocally;

  const skipNext = useCallback(() => {}, []);

  const setSpeed = useCallback((id: string, percent: number) => {
    setCards((current) =>
      current.map((card) =>
        // 过渡（回迹）中、停止中不能调速
        card.id === id && !isExecCardInTransition(card) && card.status !== "stopping"
          ? { ...card, speedPercent: percent }
          : card,
      ),
    );
  }, []);

  const emergencyStopAll = useCallback(() => {
    const handles = cardsRef.current.flatMap((card) =>
      card.sequenceHandle
        ? [
            {
              actionId: card.sequenceHandle.actionId,
              trajectoryMode: card.trajectoryMode === true,
              deviceId: card.sequenceHandle.deviceId ?? [],
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

  /** 动作真正停下来之后才能关闭任务卡 */
  const close = useCallback((id: string, options?: { release?: boolean }) => {
    const card = cardsRef.current.find((entry) => entry.id === id);
    if (!card || !canCloseExecCard(card)) return;
    if (
      options?.release !== false &&
      card.sequenceHandle &&
      !card.emergencyStopped &&
      (card.status === "paused" || card.status === "stopped")
    ) {
      void stopSequence(
        {
          actionId: card.sequenceHandle.actionId,
          trajectoryMode: card.trajectoryMode === true,
          deviceId: card.sequenceHandle.deviceId ?? [],
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
