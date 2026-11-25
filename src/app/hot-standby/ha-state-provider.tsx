import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { HaState } from "@shared/ha/types";

const HaStateContext = createContext<HaState | null>(null);

/**
 * 主备热备状态：主进程有变化才推；界面刷新后用 getState 补齐（状态在主进程，刷新不丢）。
 * 纯浏览器 / 测试环境没有 haAPI，值一直是 null。
 */
export const HaStateProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<HaState | null>(null);

  useEffect(() => {
    const api = window.haAPI;
    if (!api) return;
    let cancelled = false;
    let received = false;
    const off = api.onState((next) => {
      received = true;
      if (!cancelled) setState(next);
    });
    // 指令被热备规则拦下：说明原因（同一个提示框只留一个）
    const offBlocked = api.onBlocked?.(({ reason }) => {
      toast.warning(reason, { id: "ha-blocked" });
    });
    void api
      .getState()
      .then((snapshot) => {
        if (!cancelled && !received) setState(snapshot);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      off();
      offBlocked?.();
    };
  }, []);

  return <HaStateContext.Provider value={state}>{children}</HaStateContext.Provider>;
};

/** 没挂 Provider 或者没有 haAPI 时为 null，按没开热备处理 */
export const useHaState = (): HaState | null => useContext(HaStateContext);
