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
import { toast } from "sonner";
import { advanceRunningCards } from "./advance-running-cards";
import {
  addLaunchedCard,
  applyActionRunReports,
  canCloseExecCard,
  execCardActionId,
  fallbackActionCardSeed,
  isExecCardAtRest,
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
import { createSpeedSender } from "./sequence-speed";
import { capSpeedPercent } from "./speed-cap";

export type ExecCardSource =
  | { kind: "fader"; slotIndex: number }
  | { kind: "program" }
  | { kind: "external" }
  | { kind: "manual" };

export type ExecCardKind = "sequence";
/**
 * stopping：已下发停止，PLC 还在上报（减速中）；stopped：PLC 不再上报，停在半路；
 * completed：运行中 PLC 不再上报，按正常结束算（见 settleSilentCards）。停下和结束都留给用户关闭。
 */
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
  /** 调速范围给出的速度上限（百分比）；缺省为不限 */
  maxSpeedPercent?: number;
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
    maxSpeedPercent?: number;
    sequenceId?: number;
    sequenceHandle?: SequenceRuntimeHandle;
    trajectoryMode?: TrajectoryMode;
    totalMs?: number;
    reverse?: boolean;
  }) => string;
  pause: (id: string) => void;
  stop: (id: string) => void;
  skipNext: (id: string) => void;
  setSpeed: (id: string, percent: number) => void;
  emergencyStopAll: () => void;
  /** release=false：动作已经在别处释放过，只移除任务卡，不再下发停止 */
  close: (id: string, options?: { release?: boolean }) => void;
};

type ExecCardActions = Omit<ExecCardsContextValue, "cards">;

const ExecCardsContext = createContext<ExecCardsContextValue | null>(null);
const ExecCardActionsContext = createContext<ExecCardActions | null>(null);

type ExecCardsProviderProps = {
  children: ReactNode;
  /** PLC 上报了没有任务卡的动作时，从序列 / 执行槽取补建任务卡的信息 */
  resolveActionSeed?: (actionId: number) => ActionCardSeed;
};

const RUN_SETTLE_CHECK_MS = 100;

const isStoppable = (card: ExecCard) =>
  card.status === "running" || card.status === "stopping" || card.status === "paused";

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

      // 函数式更新：PLC 上报、静默结算（正常结束 / 已停止）可能已排在这一帧前面，不能拿渲染时的快照盖掉
      setCards((current) => advanceRunningCards(current, delta) ?? current);
      // 下一帧开头按最新的 cards 判断是否还要继续
      rafRef.current = requestAnimationFrame(tick);
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

  const launch = useCallback<ExecCardsContextValue["launch"]>(
    ({
      kind,
      name,
      durationMs,
      source,
      speedPercent = 100,
      maxSpeedPercent,
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
        ...(maxSpeedPercent !== undefined ? { maxSpeedPercent } : {}),
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

  const skipNext = useCallback(() => {}, []);

  const sendSpeedRef = useRef(createSpeedSender((message) => toast.error(message)));

  const setSpeed = useCallback((id: string, percent: number) => {
    const card = cardsRef.current.find((entry) => entry.id === id);
    // 过渡（回迹）中、停止中不能调速
    if (!card || isExecCardInTransition(card) || card.status === "stopping") return;
    const speedPercent = capSpeedPercent(percent, card.maxSpeedPercent);
    if (speedPercent === card.speedPercent) return;
    // PLC 还在执行（暂停只是本地状态）时才下发新倍率
    if (card.status === "running" || card.status === "paused") sendSpeedRef.current(card, speedPercent);
    setCards((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, speedPercent } : entry)),
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
      (card.status === "paused" || isExecCardAtRest(card))
    ) {
      // void stopSequence(
      //   {
      //     actionId: card.sequenceHandle.actionId,
      //     trajectoryMode: card.trajectoryMode === true,
      //     deviceId: card.sequenceHandle.deviceId ?? [],
      //   },
      //   getSequenceTransport(),
      // ).catch(() => undefined);
    }
    setCards((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const actions = useMemo<ExecCardActions>(
    () => ({ launch, pause, stop, skipNext, setSpeed, emergencyStopAll, close }),
    [launch, pause, stop, skipNext, setSpeed, emergencyStopAll, close],
  );
  const value = useMemo(() => ({ cards, ...actions }), [cards, actions]);

  return (
    <ExecCardActionsContext.Provider value={actions}>
      <ExecCardsContext.Provider value={value}>{children}</ExecCardsContext.Provider>
    </ExecCardActionsContext.Provider>
  );
};

export const useExecCards = (): ExecCardsContextValue => {
  const value = useContext(ExecCardsContext);
  if (!value) throw new Error("useExecCards must be used inside ExecCardsProvider");
  return value;
};

/** 任务卡运行时 cards 每帧都在变；只需要操作的组件用它，避免跟着每帧重渲染 */
export const useExecCardActions = (): ExecCardActions => {
  const value = useContext(ExecCardActionsContext);
  if (!value) throw new Error("useExecCardActions must be used inside ExecCardsProvider");
  return value;
};
