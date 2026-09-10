import { useCallback, useState } from "react";
import type { ConsoleMode } from "../components/ics/mode-tabs";

export type SessionVisibility = "idle" | "visible" | "hidden";

export type ModeSessionState = {
  visibility: SessionVisibility;
  mode: ConsoleMode;
  reloadKey: number;
};

export const useModeSession = () => {
  const [session, setSession] = useState<ModeSessionState>({
    visibility: "idle",
    mode: "debug",
    reloadKey: 0,
  });

  const isIdle = session.visibility === "idle";
  const canRestore = session.visibility === "hidden";
  const canReload = session.visibility !== "idle";
  const canStop = session.visibility !== "idle";

  const start = useCallback((mode: ConsoleMode) => {
    setSession({ visibility: "visible", mode, reloadKey: 0 });
  }, []);

  const restore = useCallback(() => {
    setSession((current) =>
      current.visibility === "hidden" ? { ...current, visibility: "visible" } : current
    );
  }, []);

  const reload = useCallback(() => {
    setSession((current) => {
      if (current.visibility === "idle") return current;
      return { ...current, reloadKey: current.reloadKey + 1 };
    });
  }, []);

  const stop = useCallback(() => {
    setSession({ visibility: "idle", mode: "debug", reloadKey: 0 });
  }, []);

  const hide = useCallback(() => {
    setSession((current) =>
      current.visibility === "visible" ? { ...current, visibility: "hidden" } : current
    );
  }, []);

  return { session, isIdle, canRestore, canReload, canStop, start, restore, reload, stop, hide };
};
