import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  INITIAL_LOGS,
  generateLogEntry,
  type LogEntry,
  type LogLevel,
} from "../components/right-tab-panel/log-tab/log-data";

const MAX_LOGS = 500;

type LogStreamContextValue = {
  logs: LogEntry[];
  liveTail: boolean;
  setLiveTail: (value: boolean) => void;
  unreadCount: number;
  markAllRead: () => void;
  acceptedLevels: Set<LogLevel>;
  setAcceptedLevels: (levels: Set<LogLevel>) => void;
};

const LogStreamContext = createContext<LogStreamContextValue | null>(null);

type LogStreamProviderProps = { children: ReactNode };

const ALL_LEVELS: LogLevel[] = ["info", "operation", "warning", "alarm", "fault"];

export const LogStreamProvider = ({ children }: LogStreamProviderProps) => {
  const [logs, setLogs] = useState<LogEntry[]>(INITIAL_LOGS);
  const [liveTail, setLiveTail] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [acceptedLevels, setAcceptedLevels] = useState<Set<LogLevel>>(new Set(ALL_LEVELS));

  useEffect(() => {
    const interval = setInterval(() => {
      const entry = generateLogEntry();
      setLogs((current) => [...current.slice(-MAX_LOGS + 1), entry]);
      if (entry.level === "alarm" || entry.level === "fault" || entry.level === "warning") {
        setUnreadCount((current) => current + 1);
      }
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  const markAllRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const value = useMemo<LogStreamContextValue>(
    () => ({ logs, liveTail, setLiveTail, unreadCount, markAllRead, acceptedLevels, setAcceptedLevels }),
    [logs, liveTail, unreadCount, markAllRead, acceptedLevels]
  );

  return <LogStreamContext.Provider value={value}>{children}</LogStreamContext.Provider>;
};

export const useLogStream = (): LogStreamContextValue => {
  const value = useContext(LogStreamContext);
  if (!value) throw new Error("useLogStream must be used inside LogStreamProvider");
  return value;
};
