import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useProject } from "@/app/project/use-project";
import { ACTION_RUN_STALE_MS, parseActionRunReports } from "./exec-card-run-status";

/** 有动作在运行时多久查一次是否已停（PLC 不通知停止，只是不再上报） */
const RUN_CHECK_MS = 250;

const NO_RUNNING: ReadonlySet<number> = new Set();

/** 记下这一帧 Info|act 里每个动作的上报时间 */
export const ingestActionRunFrame = (
  lastSeen: Map<number, number>,
  msg: unknown,
  now: number,
): void => {
  for (const report of parseActionRunReports(msg)) lastSeen.set(report.actionId, now);
};

/** 去掉超过 ACTION_RUN_STALE_MS 没再上报的动作，返回仍在运行的 actionId（升序） */
export const runningActionIdsAt = (lastSeen: Map<number, number>, now: number): number[] => {
  for (const [actionId, seenAt] of lastSeen) {
    if (now - seenAt > ACTION_RUN_STALE_MS) lastSeen.delete(actionId);
  }
  return [...lastSeen.keys()].sort((a, b) => a - b);
};

const sameIds = (set: ReadonlySet<number>, ids: readonly number[]): boolean =>
  set.size === ids.length && ids.every((id) => set.has(id));

const ActionRunContext = createContext<ReadonlySet<number>>(NO_RUNNING);

/**
 * 正在运行的动作（Info|act 有上报，含过渡），actionId 即序列 id。
 * 和轴运动一样单独订阅，不跟监控的聚合状态走；只在运行集合变化时更新。
 * 有动作在运行时才开一个定时器检查停止，没有时不留定时器。
 */
export const ActionRunProvider = ({ children }: { children: ReactNode }) => {
  const [running, setRunning] = useState<ReadonlySet<number>>(NO_RUNNING);

  useEffect(() => {
    const api = window.csocketApi;
    if (!api?.onReadActionRun) return;
    const lastSeen = new Map<number, number>();
    let timer: ReturnType<typeof setInterval> | null = null;
    const publish = () => {
      const ids = runningActionIdsAt(lastSeen, Date.now());
      setRunning((prev) => (sameIds(prev, ids) ? prev : ids.length === 0 ? NO_RUNNING : new Set(ids)));
      if (ids.length === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      } else if (ids.length > 0 && timer === null) {
        timer = setInterval(publish, RUN_CHECK_MS);
      }
    };
    const off = api.onReadActionRun((msg) => {
      ingestActionRunFrame(lastSeen, msg, Date.now());
      publish();
    });
    return () => {
      off();
      if (timer !== null) clearInterval(timer);
    };
  }, []);

  return <ActionRunContext.Provider value={running}>{children}</ActionRunContext.Provider>;
};

export const useRunningActionIds = (): ReadonlySet<number> => useContext(ActionRunContext);

/** 把正在运行的动作交给工程数据层：动作编辑和 AI 改动这些序列时在那里统一拦 */
export const ActionRunEditLockSync = () => {
  const { setRunningSequenceIds } = useProject();
  const running = useRunningActionIds();

  useEffect(() => {
    setRunningSequenceIds(running);
  }, [running, setRunningSequenceIds]);

  useEffect(() => () => setRunningSequenceIds(NO_RUNNING), [setRunningSequenceIds]);

  return null;
};
