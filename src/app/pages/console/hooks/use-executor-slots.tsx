import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PROGRAM_SLOTS_PER_PAGE } from "../components/program-panel/program-data";
import type { PageItems } from "./program-context";
import type { PreparedPoses } from "@/app/project/action-sequence/initial-pose-gate";
import type { NearestStartPlan } from "@/app/project/action-sequence/nearest-start";
import {
  resolveSlotRunOptions,
  type SlotRunOptions,
} from "@/app/project/program-item-run-options";
import type { ActionSequence } from "../components/program-panel/program-data";
import { faderToSpeedPercent } from "./speed-cap";

export { DEFAULT_SLOT_RUN_OPTIONS, type SlotRunOptions } from "@/app/project/program-item-run-options";

export type FaderSlotPhase = "idle" | "ready" | "running";

/**
 * 推子槽上挂的节目项的身份：章节 + 章节内第几项 + 序列。
 * 推子槽按章节分页复用，槽位序号在不同章节、不同页指的是不同的项；
 * 运行、准备、忙、调速上限、推子位置都按它存，换章节、翻页后各项各自显示，同一序列出现在多处也分得开。
 */
export const programItemKey = (
  chapterId: string,
  itemIndex: number,
  sequenceId: number | null,
): string => `${chapterId}#${itemIndex}#${sequenceId ?? ""}`;

export type FaderSlotState = {
  /** 当前页上的槽位（0–11），只用于显示 F1–F12 */
  index: number;
  label: string;
  /** 所挂节目项的章节 */
  chapterId: string;
  /** 所挂节目项在章节内的序号（跨页） */
  itemIndex: number;
  /** 节目项身份，见 programItemKey；推子槽的状态都按它存取 */
  itemKey: string;
  sequence: ActionSequence | null;
  /** 推子位置 0–200 */
  faderValue: number;
  /** 推子位置按调速范围换算出的实际速度百分比，GO 下发它 */
  speedPercent: number;
  phase: FaderSlotPhase;
  isBusy: boolean;
  runOptions: SlotRunOptions;
  startPlan: NearestStartPlan | null;
  preparedPoses: PreparedPoses | null;
  /** 调速范围给出的推子上限（百分比）；准备后到运行中有效，null 为不限 */
  maxSpeedPercent: number | null;
  /** 准备时下发的速度（百分比）：强制轨迹的 1006 在准备时就按它发了，GO 沿用它；只在已准备时有 */
  readySpeedPercent: number | null;
};

type SlotReadyRecord = {
  sequenceId: number;
  fingerprint: string;
  startPlan: NearestStartPlan | null;
  preparedPoses: PreparedPoses;
  speedPercent: number | null;
};

/** 准备时算出的调速上限；GO 后准备记录清掉了，运行中仍按它封顶 */
type SlotSpeedCap = { sequenceId: number; maxPercent: number | null };

/** 以下操作都传 FaderSlotState.itemKey：异步的准备 / GO 回来时可能已翻页或换章节，按槽位序号会落到别的项上 */
type ExecutorSlotsValue = {
  faderSlots: FaderSlotState[];
  setFaderValue: (itemKey: string, value: number) => void;
  setSlotRunning: (itemKey: string, running: boolean) => void;
  /** 按任务卡整体同步哪些节目项在运行（含不在当前页的），不在集合里的都不算运行 */
  syncRunningSlots: (itemKeys: ReadonlySet<string>) => void;
  setSlotBusy: (itemKey: string, busy: boolean) => void;
  setSlotRunOptions: (itemKey: string, patch: Partial<SlotRunOptions>) => void;
  markSlotReady: (
    itemKey: string,
    sequenceId: number,
    fingerprint: string,
    startPlan: NearestStartPlan | null,
    preparedPoses: PreparedPoses,
    maxSpeedPercent?: number | null,
    readySpeedPercent?: number | null,
  ) => void;
  clearSlotReady: (itemKey: string) => void;
};

type ExecutorSlotActions = {
  /** 总停止后全部推子槽回到未准备 */
  resetAllSlots: () => void;
};

const ExecutorSlotsContext = createContext<ExecutorSlotsValue | null>(null);
const ExecutorSlotActionsContext = createContext<ExecutorSlotActions | null>(null);

type ExecutorSlotsProviderProps = {
  children: ReactNode;
  pageItems: PageItems;
  sequenceFingerprints: Readonly<Record<number, string>>;
  /** 运行选项存于节目条目；改动交给节目写回工程（章节 + 章节内序号） */
  onSlotRunOptionsChange?: (chapterId: string, itemIndex: number, runOptions: SlotRunOptions) => void;
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

const EMPTY_KEYS: ReadonlySet<string> = new Set();

const toggleKey = (
  current: ReadonlySet<string>,
  key: string,
  on: boolean,
): ReadonlySet<string> => {
  if (current.has(key) === on) return current;
  const next = new Set(current);
  if (on) next.add(key);
  else next.delete(key);
  return next;
};

const sameKeys = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean => {
  if (left.size !== right.size) return false;
  for (const key of left) if (!right.has(key)) return false;
  return true;
};

export const ExecutorSlotsProvider = ({
  children,
  pageItems,
  sequenceFingerprints,
  onSlotRunOptionsChange,
}: ExecutorSlotsProviderProps) => {
  // 全部按节目项身份（programItemKey）存：键里带着序列，项换了序列旧状态自然对不上
  const [faderValues, setFaderValues] = useState<Record<string, number>>({});
  // 运行集合以 ref 为准：同一轮里 setSlotRunning 和 syncRunningSlots 先后调用也不会拿到旧值
  const runningSlotsRef = useRef<ReadonlySet<string>>(EMPTY_KEYS);
  const [runningSlots, setRunningSlots] = useState<ReadonlySet<string>>(EMPTY_KEYS);
  const [busySlots, setBusySlots] = useState<ReadonlySet<string>>(EMPTY_KEYS);
  const [readyBySlot, setReadyBySlot] = useState<Record<string, SlotReadyRecord>>({});
  const [speedCapBySlot, setSpeedCapBySlot] = useState<Record<string, SlotSpeedCap>>({});
  const commitRunningSlots = useCallback((next: ReadonlySet<string>) => {
    if (next === runningSlotsRef.current) return;
    runningSlotsRef.current = next;
    setRunningSlots(next);
  }, []);

  const { chapterId, startIndex } = pageItems;
  const faderSlots = useMemo<FaderSlotState[]>(
    () =>
      Array.from({ length: PROGRAM_SLOTS_PER_PAGE }, (_, idx) => {
        const item = pageItems.sequences[idx];
        const sequence = item?.kind === "sequence" ? item.sequence : null;
        const itemIndex = startIndex + idx;
        const itemKey = programItemKey(chapterId, itemIndex, sequence?.id ?? null);
        const fingerprint = sequence ? sequenceFingerprints[sequence.id] ?? null : null;
        const ready = readyBySlot[itemKey] ?? null;
        const isRunning = sequence !== null && runningSlots.has(itemKey);
        const phase = deriveFaderSlotPhase({
          sequenceId: sequence?.id ?? null,
          fingerprint,
          ready,
          isRunning,
        });
        const cap = speedCapBySlot[itemKey];
        const maxSpeedPercent =
          phase !== "idle" && cap && cap.sequenceId === sequence?.id ? cap.maxPercent : null;
        const faderValue = faderValues[itemKey] ?? 100;
        return {
          index: idx,
          label: `F${idx + 1}`,
          chapterId,
          itemIndex,
          itemKey,
          sequence,
          faderValue,
          speedPercent: faderToSpeedPercent(faderValue, maxSpeedPercent),
          phase,
          isBusy: sequence !== null && busySlots.has(itemKey),
          runOptions: resolveSlotRunOptions(item?.runOptions),
          startPlan: phase === "ready" && ready ? ready.startPlan : null,
          preparedPoses: phase === "ready" && ready ? ready.preparedPoses : null,
          maxSpeedPercent,
          readySpeedPercent: phase === "ready" && ready ? ready.speedPercent : null,
        };
      }),
    [
      pageItems.sequences,
      chapterId,
      startIndex,
      sequenceFingerprints,
      faderValues,
      runningSlots,
      busySlots,
      readyBySlot,
      speedCapBySlot,
    ],
  );

  const setFaderValue = useCallback((itemKey: string, value: number) => {
    setFaderValues((current) => ({ ...current, [itemKey]: value }));
  }, []);

  const setSlotRunning = useCallback(
    (itemKey: string, running: boolean) => {
      commitRunningSlots(toggleKey(runningSlotsRef.current, itemKey, running));
    },
    [commitRunningSlots],
  );

  const syncRunningSlots = useCallback(
    (itemKeys: ReadonlySet<string>) => {
      // 任务卡每帧都在变；集合没变就不 setState，免得每帧排一次更新
      if (sameKeys(runningSlotsRef.current, itemKeys)) return;
      commitRunningSlots(new Set(itemKeys));
    },
    [commitRunningSlots],
  );

  const setSlotBusy = useCallback((itemKey: string, busy: boolean) => {
    setBusySlots((current) => toggleKey(current, itemKey, busy));
  }, []);

  const setSlotRunOptions = useCallback(
    (itemKey: string, patch: Partial<SlotRunOptions>) => {
      const slot = faderSlots.find((entry) => entry.itemKey === itemKey);
      const item = slot ? pageItems.sequences[slot.index] : undefined;
      if (!slot || !item) return;
      onSlotRunOptionsChange?.(slot.chapterId, slot.itemIndex, {
        ...resolveSlotRunOptions(item.runOptions),
        ...patch,
      });
    },
    [faderSlots, pageItems.sequences, onSlotRunOptionsChange],
  );

  const markSlotReady = useCallback(
    (
      itemKey: string,
      sequenceId: number,
      fingerprint: string,
      startPlan: NearestStartPlan | null,
      preparedPoses: PreparedPoses,
      maxSpeedPercent: number | null = null,
      readySpeedPercent: number | null = null,
    ) => {
      setReadyBySlot((current) => ({
        ...current,
        [itemKey]: { sequenceId, fingerprint, startPlan, preparedPoses, speedPercent: readySpeedPercent },
      }));
      setSpeedCapBySlot((current) => ({
        ...current,
        [itemKey]: { sequenceId, maxPercent: maxSpeedPercent },
      }));
    },
    [],
  );

  const clearSlotReady = useCallback((itemKey: string) => {
    setReadyBySlot((current) => {
      if (!(itemKey in current)) return current;
      const next = { ...current };
      delete next[itemKey];
      return next;
    });
  }, []);

  const resetAllSlots = useCallback(() => {
    setReadyBySlot({});
    commitRunningSlots(EMPTY_KEYS);
    setSpeedCapBySlot({});
  }, [commitRunningSlots]);

  const actions = useMemo<ExecutorSlotActions>(() => ({ resetAllSlots }), [resetAllSlots]);

  const value = useMemo(
    () => ({
      faderSlots,
      setFaderValue,
      setSlotRunning,
      syncRunningSlots,
      setSlotBusy,
      setSlotRunOptions,
      markSlotReady,
      clearSlotReady,
    }),
    [
      faderSlots,
      setFaderValue,
      setSlotRunning,
      syncRunningSlots,
      setSlotBusy,
      setSlotRunOptions,
      markSlotReady,
      clearSlotReady,
    ],
  );

  return (
    <ExecutorSlotActionsContext.Provider value={actions}>
      <ExecutorSlotsContext.Provider value={value}>{children}</ExecutorSlotsContext.Provider>
    </ExecutorSlotActionsContext.Provider>
  );
};

export const useExecutorSlots = (): ExecutorSlotsValue => {
  const value = useContext(ExecutorSlotsContext);
  if (!value) throw new Error("useExecutorSlots must be used inside ExecutorSlotsProvider");
  return value;
};

/** 推子一动 faderSlots 就变；只需要操作的组件用它，避免跟着重渲染 */
export const useExecutorSlotActions = (): ExecutorSlotActions => {
  const value = useContext(ExecutorSlotActionsContext);
  if (!value) throw new Error("useExecutorSlotActions must be used inside ExecutorSlotsProvider");
  return value;
};
