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
  applyGoBindings,
  buildMoveTargetItem,
  goEntriesForObjectIds,
  goEntryProgress,
  goPhaseFromEntries,
  markGoDispatched,
  pendingGoEntries,
  releaseGoEntries,
  type GoBindings,
  type GoReadyEntry,
  type GoReadyState,
} from "./go-ready";
import { useControlledObjects } from "./use-controlled-objects";
import { useConsoleMode } from "./use-console-mode";
import { useConsoleNav } from "./use-console-nav";
import { useProjectStore } from "./use-project-store";

const IDLE_STATE: GoReadyState = { phase: "idle", mode: "abs", entries: [] };

const NO_BINDINGS: GoBindings = new Map();

const stateFromEntries = (current: GoReadyState, entries: GoReadyEntry[]): GoReadyState => {
  const phase = goPhaseFromEntries(entries);
  if (phase === "idle") return IDLE_STATE;
  return { ...current, phase, entries };
};

type GoReadyContextValue = {
  state: GoReadyState;
  arm: (entries: GoReadyEntry[], mode: "abs" | "rel") => void;
  go: (objectIds?: readonly string[]) => Promise<void>;
  cancel: (objectIds?: readonly string[]) => void;
  clear: () => void;
  /** 动作页联机：把这些物体的 GO 目标钉在选中的位姿上；null 解除 */
  bind: (bindings: GoBindings | null) => void;
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
  /** 已下发的物体从什么时候起一直在容差内（按物体，换一次下发重新计） */
  const arrivedSinceRef = useRef(new Map<string, { dispatchedAt?: number; since: number }>());
  const [recheck, setRecheck] = useState(0);
  const bindingsRef = useRef<GoBindings>(NO_BINDINGS);

  const clear = useCallback(() => {
    bindingsRef.current = NO_BINDINGS;
    setState(IDLE_STATE);
  }, []);

  const bind = useCallback((bindings: GoBindings | null) => {
    const previous = bindingsRef.current;
    const next = bindings ?? NO_BINDINGS;
    if (previous.size === 0 && next.size === 0) return;
    bindingsRef.current = next;
    setState((current) =>
      stateFromEntries(current, applyGoBindings(current.entries, previous, next)),
    );
  }, []);

  const arm = useCallback((entries: GoReadyEntry[], mode: "abs" | "rel") => {
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
    if (objectIds === undefined && bindingsRef.current.size === 0) {
      clear();
      return;
    }
    if (objectIds?.length === 0) return;
    // 绑定在位姿上的物体清除后回到位姿值
    setState((current) => {
      const ids = objectIds ?? current.entries.map((entry) => entry.objectId);
      return stateFromEntries(current, releaseGoEntries(current.entries, ids, bindingsRef.current));
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
    // 等应答期间又改了目标（或清除）的物体不标下发：新目标还没发出去
    const sent = new Set(entries);
    setState((current) => {
      const dispatchedIds = current.entries
        .filter((entry) => sent.has(entry))
        .map((entry) => entry.objectId);
      if (dispatchedIds.length === 0) return current;
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
      setState((prev) =>
        stateFromEntries(
          prev,
          prev.entries.filter((entry) => ids.has(entry.objectId)),
        ),
      );
    }
  }, [objects, clear]);

  // 已下发的物体各自走完（到位，或停下 / 报警）就去掉它的 GO 目标（未下发的准备目标保留）；
  // 绑定在位姿上的物体回到位姿值。主进程只在数值变化时转发遥测，物体停下后不再有帧，
  // 所以到了要重新判断的时刻用一个一次性定时器补判一次（只在有已下发条目时存在）。
  useEffect(() => {
    const dispatched = state.entries.filter((entry) => entry.dispatched);
    if (dispatched.length === 0) {
      arrivedSinceRef.current.clear();
      return;
    }
    const now = Date.now();
    const previous = arrivedSinceRef.current;
    const arrivedSince = new Map<string, { dispatchedAt?: number; since: number }>();
    const done = new Set<GoReadyEntry>();
    let recheckAt = Number.POSITIVE_INFINITY;
    for (const entry of dispatched) {
      const prev = previous.get(entry.objectId);
      const progress = goEntryProgress(
        entry,
        getById(Number(entry.objectId)),
        now,
        prev && prev.dispatchedAt === entry.dispatchedAt ? prev.since : undefined,
      );
      if (progress.done) {
        done.add(entry);
        continue;
      }
      if (progress.arrivedSince !== undefined) {
        arrivedSince.set(entry.objectId, {
          dispatchedAt: entry.dispatchedAt,
          since: progress.arrivedSince,
        });
      }
      if (progress.recheckAt !== undefined) recheckAt = Math.min(recheckAt, progress.recheckAt);
    }
    arrivedSinceRef.current = arrivedSince;
    if (done.size > 0) {
      setState((prev) => {
        const ids = prev.entries.filter((entry) => done.has(entry)).map((entry) => entry.objectId);
        if (ids.length === 0) return prev;
        return stateFromEntries(prev, releaseGoEntries(prev.entries, ids, bindingsRef.current));
      });
      return;
    }
    if (!Number.isFinite(recheckAt)) return;
    const timer = setTimeout(() => setRecheck((value) => value + 1), Math.max(0, recheckAt - now));
    return () => clearTimeout(timer);
  }, [state.entries, snapshots, getById, recheck]);

  const value = useMemo<GoReadyContextValue>(
    () => ({ state, arm, go, cancel, clear, bind }),
    [state, arm, go, cancel, clear, bind],
  );

  return <GoReadyContext.Provider value={value}>{children}</GoReadyContext.Provider>;
};

export const useGoReady = (): GoReadyContextValue => {
  const value = useContext(GoReadyContext);
  if (!value) throw new Error("useGoReady must be used inside GoReadyProvider");
  return value;
};
