import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ControlLayoutContextValue = {
  monitorPanelVisible: boolean;
  programPanelVisible: boolean;
  rightPanelVisible: boolean;
  toggleMonitorPanel: () => void;
  toggleProgramPanel: () => void;
  toggleRightPanel: () => void;
};

const ControlLayoutContext = createContext<ControlLayoutContextValue | null>(null);

export const ControlLayoutProvider = ({ children }: { children: ReactNode }) => {
  const [monitorPanelVisible, setMonitorPanelVisible] = useState(true);
  const [programPanelVisible, setProgramPanelVisible] = useState(false);
  const [rightPanelVisible, setRightPanelVisible] = useState(false);

  const toggleMonitorPanel = useCallback(
    () => setMonitorPanelVisible((current) => !current),
    [],
  );
  const toggleProgramPanel = useCallback(
    () => setProgramPanelVisible((current) => !current),
    [],
  );
  const toggleRightPanel = useCallback(() => setRightPanelVisible((current) => !current), []);

  const value = useMemo(
    (): ControlLayoutContextValue => ({
      monitorPanelVisible,
      programPanelVisible,
      rightPanelVisible,
      toggleMonitorPanel,
      toggleProgramPanel,
      toggleRightPanel,
    }),
    [
      monitorPanelVisible,
      programPanelVisible,
      rightPanelVisible,
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
