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
import { ProjectContext } from "@/app/project/project-provider";
import {
  goObjectInfoFromSetup,
  planGo,
  type GoObjectInfo,
  type GoPlan,
  type GoTiming,
} from "./go-motion";
import {
  applyGoBindings,
  buildMoveTargetItem,
  goEntriesForObjectIds,
  goEntryProgress,
  goPhaseFromEntries,
  markGoDispatched,
  pendingGoEntries,
  positionsToAxisValues,
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
  /** 换成这些目标（去掉别的准备目标和位姿绑定），如序列库的「去这里」 */
  setTargets: (entries: GoReadyEntry[]) => void;
  /** 走法：各自默认速度 / 同时到达 / 指定时长，本次运行期间记住 */
  timing: GoTiming;
  setTiming: (timing: GoTiming) => void;
  /** 无极旋转物体手选的方向；没选的按转得少的那边 */
  directions: Readonly<Record<string, 1 | 2>>;
  setDirection: (objectId: string, direction: 1 | 2 | null) => void;
  /** 还没下发的目标按现在的走法怎么走、要多久（按设目标时的位置算，不随遥测变） */
  plan: GoPlan;
};

const GoReadyContext = createContext<GoReadyContextValue | null>(null);

type GoReadyProviderProps = { children: ReactNode };

export const GoReadyProvider = ({ children }: GoReadyProviderProps) => {
  const { snapshots, getById } = useControlledObjects();
  const { objects } = useProjectStore();
  // 没有工程（单独挂 GO 时）就不知道速度和旋转周期：只能按默认速度走，不显示用时
  const setup = useContext(ProjectContext)?.currentProject?.document?.setup;
  const { activeNav } = useConsoleNav();
  const { mode: consoleMode } = useConsoleMode();

  const [state, setState] = useState<GoReadyState>(IDLE_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  /** 已下发的物体从什么时候起一直在容差内（按物体，换一次下发重新计） */
  const arrivedSinceRef = useRef(new Map<string, { dispatchedAt?: number; since: number }>());
  const [recheck, setRecheck] = useState(0);
  const bindingsRef = useRef<GoBindings>(NO_BINDINGS);
  const [timing, setTiming] = useState<GoTiming>({ kind: "default" });
  const [directions, setDirections] = useState<Record<string, 1 | 2>>({});

  const infoById = useMemo(() => {
    const map = new Map<string, GoObjectInfo>();
    if (!setup) return map;
    for (const object of setup.controlledObjects) {
      map.set(String(object.id), goObjectInfoFromSetup(object, setup.motors));
    }
    return map;
  }, [setup]);
  const infoOf = useCallback((objectId: string) => infoById.get(objectId) ?? null, [infoById]);
  const plan = useMemo(
    () => planGo(pendingGoEntries(state.entries), infoOf, timing, directions),
    [state.entries, infoOf, timing, directions],
  );
  // GO 时按最新位置再算一次
  const latestRef = useRef({ infoOf, timing, directions, getById });
  latestRef.current = { infoOf, timing, directions, getById };

  const setDirection = useCallback((objectId: string, direction: 1 | 2 | null) => {
    setDirections((current) => {
      const next = { ...current };
      if (direction === null) delete next[objectId];
      else next[objectId] = direction;
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    bindingsRef.current = NO_BINDINGS;
    setDirections({});
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

  const setTargets = useCallback((entries: GoReadyEntry[]) => {
    bindingsRef.current = NO_BINDINGS;
    setDirections({});
    setState(
      entries.length === 0
        ? IDLE_STATE
        : { phase: "armed", mode: "abs", entries: entries.map((entry) => ({ ...entry, dispatched: false })) },
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
    const latest = latestRef.current;
    const live = entries.map((entry) => ({
      ...entry,
      current: {
        ...entry.current,
        ...positionsToAxisValues(latest.getById(Number(entry.objectId))?.positions ?? null),
      },
    }));
    const goPlan = planGo(live, latest.infoOf, latest.timing, latest.directions);
    if (goPlan.error) {
      toast.warning(goPlan.error);
      return;
    }
    const planById = new Map(goPlan.objects.map((item) => [item.objectId, item]));
    const result = await api.moveTargetModel(
      entries.map((entry) => buildMoveTargetItem(entry, planById.get(entry.objectId))),
    );
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
    () => ({
      state,
      arm,
      go,
      cancel,
      clear,
      bind,
      setTargets,
      timing,
      setTiming,
      directions,
      setDirection,
      plan,
    }),
    [state, arm, go, cancel, clear, bind, setTargets, timing, directions, setDirection, plan],
  );

  return <GoReadyContext.Provider value={value}>{children}</GoReadyContext.Provider>;
};

/** 不在 GoReadyProvider 里时为 null（序列库等组件单独渲染时） */
export const useOptionalGoReady = (): GoReadyContextValue | null => useContext(GoReadyContext);

export const useGoReady = (): GoReadyContextValue => {
  const value = useContext(GoReadyContext);
  if (!value) throw new Error("useGoReady must be used inside GoReadyProvider");
  return value;
};
