import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { mergeRecentLogs, type LogRecord } from "@shared/csocket/operation-log";
import { getLastOpenProjectAck, subscribeLastOpenProjectAck } from "./project-verify";

type LogStreamContextValue = {
  /** 当前工程打开后 C++ 推送的最新 RECENT_LOG_LIMIT 条（不含 debug），时间升序 */
  logs: LogRecord[];
  latest: LogRecord | null;
  liveTail: boolean;
  setLiveTail: (value: boolean) => void;
};

const LogStreamContext = createContext<LogStreamContextValue | null>(null);

const getCsocketApi = () => (typeof window !== "undefined" ? window.csocketApi : undefined);

type LogStreamProviderProps = { children: ReactNode };

export const LogStreamProvider = ({ children }: LogStreamProviderProps) => {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [liveTail, setLiveTail] = useState(true);
  // 日志按工程独立：每次打开工程都从空列表开始
  const openAck = useSyncExternalStore(
    subscribeLastOpenProjectAck,
    getLastOpenProjectAck,
    getLastOpenProjectAck,
  );

  useEffect(() => {
    const api = getCsocketApi();
    if (!api?.onLog) return;
    return api.onLog((msg) => {
      if (!msg?.success || !Array.isArray(msg.data) || msg.data.length === 0) return;
      const incoming = msg.data;
      setLogs((current) => mergeRecentLogs(current, incoming));
    });
  }, []);

  useEffect(() => {
    setLogs([]);
  }, [openAck]);

  const value = useMemo<LogStreamContextValue>(
    () => ({ logs, latest: logs.at(-1) ?? null, liveTail, setLiveTail }),
    [logs, liveTail],
  );

  return <LogStreamContext.Provider value={value}>{children}</LogStreamContext.Provider>;
};

export const useLogStream = (): LogStreamContextValue => {
  const value = useContext(LogStreamContext);
  if (!value) throw new Error("useLogStream must be used inside LogStreamProvider");
  return value;
};
