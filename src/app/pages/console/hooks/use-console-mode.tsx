import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ConsoleMode = "rehearsal" | "show";

type ConsoleModeContextValue = {
  mode: ConsoleMode;
  isLocked: boolean;
  enterShow: () => void;
  exitShow: () => void;
  lock: () => void;
  unlock: () => void;
};

const ConsoleModeContext = createContext<ConsoleModeContextValue | null>(null);

type ConsoleModeProviderProps = { children: ReactNode };

export const ConsoleModeProvider = ({ children }: ConsoleModeProviderProps) => {
  const [mode, setMode] = useState<ConsoleMode>("rehearsal");
  const [isLocked, setIsLocked] = useState(false);

  const enterShow = useCallback(() => {
    setMode("show");
  }, []);

  const exitShow = useCallback(() => {
    setMode("rehearsal");
    setIsLocked(false);
  }, []);

  const lock = useCallback(() => {
    setIsLocked(true);
  }, []);

  const unlock = useCallback(() => {
    setIsLocked(false);
  }, []);

  const value = useMemo(
    () => ({ mode, isLocked, enterShow, exitShow, lock, unlock }),
    [mode, isLocked, enterShow, exitShow, lock, unlock]
  );

  return <ConsoleModeContext.Provider value={value}>{children}</ConsoleModeContext.Provider>;
};

export const useConsoleMode = (): ConsoleModeContextValue => {
  const value = useContext(ConsoleModeContext);
  if (!value) throw new Error("useConsoleMode must be used inside ConsoleModeProvider");
  return value;
};
