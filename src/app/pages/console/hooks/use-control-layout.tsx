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
  /** 右栏打开且当前是手动控制 */
  manualPanelVisible: boolean;
  /** 右栏打开且当前是节目 */
  programPanelVisible: boolean;
  rightPanelVisible: boolean;
  activeRightTab: ControlRightTabId;
  setActiveRightTab: (tab: ControlRightTabId) => void;
  toggleMonitorPanel: () => void;
  toggleManualPanel: () => void;
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
  const bindPanelToTab = useCallback((tab: ControlRightTabId) => {
    setRightPanelVisible((visible) => (visible && activeRightTab === tab ? false : true));
    setActiveRightTab(tab);
  }, [activeRightTab]);
  const toggleManualPanel = useCallback(() => bindPanelToTab("manual"), [bindPanelToTab]);
  const toggleProgramPanel = useCallback(() => bindPanelToTab("program"), [bindPanelToTab]);

  const manualPanelVisible = rightPanelVisible && activeRightTab === "manual";
  const programPanelVisible = rightPanelVisible && activeRightTab === "program";

  const value = useMemo(
    (): ControlLayoutContextValue => ({
      monitorPanelVisible,
      manualPanelVisible,
      programPanelVisible,
      rightPanelVisible,
      activeRightTab,
      setActiveRightTab,
      toggleMonitorPanel,
      toggleManualPanel,
      toggleProgramPanel,
      toggleRightPanel,
    }),
    [
      monitorPanelVisible,
      manualPanelVisible,
      programPanelVisible,
      rightPanelVisible,
      activeRightTab,
      toggleMonitorPanel,
      toggleManualPanel,
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
