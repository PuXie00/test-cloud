import { createContext, useContext, type ReactNode } from "react";
import type { LeftNavId } from "../components/LeftSidebar";
import type { RightPanelTab } from "../components/RightSidebar";

export type ConsoleNavOptions = {
  devicesTab?: RightPanelTab;
};

type ConsoleNavContextValue = {
  activeNav: LeftNavId;
  navigate: (id: LeftNavId, options?: ConsoleNavOptions) => void;
};

const ConsoleNavContext = createContext<ConsoleNavContextValue | null>(null);

export const ConsoleNavProvider = ({
  activeNav,
  navigate,
  children,
}: {
  activeNav: LeftNavId;
  navigate: (id: LeftNavId, options?: ConsoleNavOptions) => void;
  children: ReactNode;
}) => (
  <ConsoleNavContext.Provider value={{ activeNav, navigate }}>{children}</ConsoleNavContext.Provider>
);

export const useConsoleNav = (): ConsoleNavContextValue => {
  const ctx = useContext(ConsoleNavContext);
  if (!ctx) throw new Error("useConsoleNav must be used inside ConsoleNavProvider");
  return ctx;
};
