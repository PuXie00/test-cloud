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
import { isCppAckFailed } from "@shared/csocket/ack";
import {
  ARRIVAL_TOLERANCE,
  buildMoveTargetItem,
  goEntriesForObjectIds,
  goPhaseFromEntries,
  isArrived,
  markGoDispatched,
  pendingGoEntries,
  positionsToAxisValues,
  removeGoEntries,
  type GoReadyEntry,
  type GoReadyState,
} from "./go-ready";
import { useControlledObjects } from "./use-controlled-objects";
import { useConsoleMode } from "./use-console-mode";
import { useConsoleNav } from "./use-console-nav";
import { useProjectStore } from "./use-project-store";

const IDLE_STATE: GoReadyState = { phase: "idle", mode: "abs", entries: [] };

type GoReadyContextValue = {
  state: GoReadyState;
  arm: (entries: GoReadyEntry[], mode: "abs" | "rel") => void;
  go: (objectIds?: readonly string[]) => Promise<void>;
  cancel: (objectIds?: readonly string[]) => void;
  clear: () => void;
};

const GoReadyContext = createContext<GoReadyContextValue | null>(null);

type GoReadyProviderProps = { children: ReactNode };

export const GoReadyProvider = ({ children }: GoReadyProviderProps) => {
  const { snapshots, getById } = useControlledObjects();
  const { objects } = useProjectStore();
  const { activeNav } = useConsoleNav();
  const { mode: consoleMode } = useConsoleMode();

  const [state, setState] = useState<GoReadyState>(IDLE_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const arriveStreakRef = useRef(0);

  const clear = useCallback(() => {
    arriveStreakRef.current = 0;
    setState(IDLE_STATE);
  }, []);

  const arm = useCallback((entries: GoReadyEntry[], mode: "abs" | "rel") => {
    arriveStreakRef.current = 0;
    setState((current) => {
      const byId = new Map(current.entries.map((entry) => [entry.objectId, entry]));
      for (const entry of entries) {
        const prev = byId.get(entry.objectId);
        byId.set(entry.objectId, {
          objectId: entry.objectId,
          current: entry.current,
          target: prev ? { ...prev.target, ...entry.target } : entry.target,
          dispatched: false,
        });
      }
      return { phase: "armed", mode, entries: [...byId.values()] };
    });
  }, []);

  const cancel = useCallback((objectIds?: readonly string[]) => {
    if (objectIds === undefined) {
      clear();
      return;
    }
    if (objectIds.length === 0) return;
    setState((current) => {
      const entries = removeGoEntries(current.entries, objectIds);
      const phase = goPhaseFromEntries(entries);
      if (phase === "idle") {
        arriveStreakRef.current = 0;
        return IDLE_STATE;
      }
      return { ...current, phase, entries };
    });
  }, [clear]);

  const go = useCallback(async (objectIds?: readonly string[]) => {
    if (objectIds && objectIds.length === 0) return;
    const api = window.csocketApi;
    const pool = objectIds
      ? goEntriesForObjectIds(stateRef.current.entries, objectIds)
      : stateRef.current.entries;
    const entries = pendingGoEntries(pool);
    if (!api?.moveTargetModel) {
      toast.error("C++ 未连接，无法执行 GO");
      return;
    }
    if (entries.length === 0) return;
    const result = await api.moveTargetModel(entries.map((entry) => buildMoveTargetItem(entry)));
    if (isCppAckFailed(result)) {
      toast.error("GO 指令失败，保持准备状态");
      return;
    }
    const dispatchedIds = entries.map((entry) => entry.objectId);
    setState((current) => {
      const nextEntries = markGoDispatched(current.entries, dispatchedIds);
      return { ...current, phase: goPhaseFromEntries(nextEntries), entries: nextEntries };
    });
  }, []);

  // 切换导航 / 模式时回到 idle；选择变化不清除，GO 准备可跨物体累积
  useEffect(() => {
    clear();
  }, [activeNav, consoleMode, clear]);

  // 物体被删除时清理对应 entry
  useEffect(() => {
    const current = stateRef.current;
    if (current.phase === "idle") return;
    const ids = new Set(objects.map((object) => String(object.id)));
    const entries = current.entries.filter((entry) => ids.has(entry.objectId));
    if (entries.length === 0) {
      clear();
      return;
    }
    if (entries.length !== current.entries.length) {
      setState((prev) => {
        const nextEntries = prev.entries.filter((entry) => ids.has(entry.objectId));
        const phase = goPhaseFromEntries(nextEntries);
        if (phase === "idle") return IDLE_STATE;
        return { ...prev, phase, entries: nextEntries };
      });
    }
  }, [objects, clear]);

  // 已下发条目到位后移除（未下发的准备目标保留）
  useEffect(() => {
    const current = stateRef.current;
    const dispatched = current.entries.filter((entry) => entry.dispatched);
    if (dispatched.length === 0) {
      arriveStreakRef.current = 0;
      return;
    }
    const allArrived = dispatched.every((entry) => {
      const snapshot = getById(Number(entry.objectId));
      if (!snapshot) return false;
      return isArrived(positionsToAxisValues(snapshot.positions), entry.target, ARRIVAL_TOLERANCE);
    });
    if (allArrived) {
      arriveStreakRef.current += 1;
      if (arriveStreakRef.current >= 3) {
        const dispatchedIds = dispatched.map((entry) => entry.objectId);
        setState((prev) => {
          const entries = removeGoEntries(prev.entries, dispatchedIds);
          const phase = goPhaseFromEntries(entries);
          if (phase === "idle") return IDLE_STATE;
          return { ...prev, phase, entries };
        });
        arriveStreakRef.current = 0;
      }
    } else {
      arriveStreakRef.current = 0;
    }
  }, [snapshots, getById]);

  const value = useMemo<GoReadyContextValue>(
    () => ({ state, arm, go, cancel, clear }),
    [state, arm, go, cancel, clear],
  );

  return <GoReadyContext.Provider value={value}>{children}</GoReadyContext.Provider>;
};

export const useGoReady = (): GoReadyContextValue => {
  const value = useContext(GoReadyContext);
  if (!value) throw new Error("useGoReady must be used inside GoReadyProvider");
  return value;
};
