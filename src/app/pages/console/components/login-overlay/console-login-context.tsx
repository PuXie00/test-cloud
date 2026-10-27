import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/app/auth/use-auth";

type ConsoleLoginValue = {
  /** 切换用户：登录框打开，原用户在新用户登录成功前保持登录 */
  switchUserOpen: boolean;
  openSwitchUser: () => void;
  closeSwitchUser: () => void;
  /** 退出登录：结束会话，控制台不卸载，原地显示登录框 */
  logoutInPlace: () => Promise<void>;
};

const ConsoleLoginContext = createContext<ConsoleLoginValue | null>(null);

export const ConsoleLoginProvider = ({ children }: { children: ReactNode }) => {
  const { logout } = useAuth();
  const [switchUserOpen, setSwitchUserOpen] = useState(false);
  const openSwitchUser = useCallback(() => setSwitchUserOpen(true), []);
  const closeSwitchUser = useCallback(() => setSwitchUserOpen(false), []);
  const logoutInPlace = useCallback(async () => {
    setSwitchUserOpen(false);
    await logout();
  }, [logout]);
  const value = useMemo(
    () => ({ switchUserOpen, openSwitchUser, closeSwitchUser, logoutInPlace }),
    [switchUserOpen, openSwitchUser, closeSwitchUser, logoutInPlace],
  );
  return <ConsoleLoginContext.Provider value={value}>{children}</ConsoleLoginContext.Provider>;
};

export const useConsoleLogin = (): ConsoleLoginValue => {
  const ctx = useContext(ConsoleLoginContext);
  if (!ctx) throw new Error("useConsoleLogin must be used inside ConsoleLoginProvider");
  return ctx;
};
