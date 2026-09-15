import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ControlRightTabId = "manual" | "program" | "log" | "detail";

type ControlLayoutContextValue = {
  monitorPanelVisible: boolean;
  programPanelVisible: boolean;
  rightPanelVisible: boolean;
  activeRightTab: ControlRightTabId;
  setActiveRightTab: (tab: ControlRightTabId) => void;
  toggleMonitorPanel: () => void;
  toggleProgramPanel: () => void;
  toggleRightPanel: () => void;
};

const ControlLayoutContext = createContext<ControlLayoutContextValue | null>(null);

export const ControlLayoutProvider = ({ children }: { children: ReactNode }) => {
  const [monitorPanelVisible, setMonitorPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState<ControlRightTabId>("log");

  const toggleMonitorPanel = useCallback(
    () => setMonitorPanelVisible((current) => !current),
    [],
  );
  const toggleRightPanel = useCallback(() => setRightPanelVisible((current) => !current), []);
  const toggleProgramPanel = useCallback(() => {
    setRightPanelVisible((visible) => {
      if (visible && activeRightTab === "program") return false;
      return true;
    });
    setActiveRightTab("program");
  }, [activeRightTab]);

  const programPanelVisible = rightPanelVisible && activeRightTab === "program";

  const value = useMemo(
    (): ControlLayoutContextValue => ({
      monitorPanelVisible,
      programPanelVisible,
      rightPanelVisible,
      activeRightTab,
      setActiveRightTab,
      toggleMonitorPanel,
      toggleProgramPanel,
      toggleRightPanel,
    }),
    [
      monitorPanelVisible,
      programPanelVisible,
      rightPanelVisible,
      activeRightTab,
      toggleMonitorPanel,
      toggleProgramPanel,
      toggleRightPanel,
    ],
  );

  return <ControlLayoutContext.Provider value={value}>{children}</ControlLayoutContext.Provider>;
};

export const useControlLayout = (): ControlLayoutContextValue => {
  const value = useContext(ControlLayoutContext);
  if (!value) {
    throw new Error("useControlLayout must be used inside ControlLayoutProvider");
  }
  return value;
};
