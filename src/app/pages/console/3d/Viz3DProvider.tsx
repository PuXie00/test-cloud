import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import { destroyViz3DEngine, getViz3DEngine, type Viz3DEngine } from "@/app/viz3d";

const Viz3DContext = createContext<Viz3DEngine | null>(null);

type Viz3DProviderProps = {
  children: ReactNode;
};

export const Viz3DProvider = ({ children }: Viz3DProviderProps) => {
  const engine = useMemo(() => getViz3DEngine(), []);
  const sessionDisplayUnit = useSessionDisplayLengthUnit();

  // 显示单位跟着登录用户走：切换用户 / 改偏好时更新引擎，标签随下一帧遥测刷新
  useEffect(() => {
    engine.setDisplayLengthUnit(sessionDisplayUnit);
  }, [engine, sessionDisplayUnit]);

  useEffect(() => {
    return () => {
      destroyViz3DEngine();
    };
  }, []);

  return <Viz3DContext.Provider value={engine}>{children}</Viz3DContext.Provider>;
};

export const useViz3DContext = (): Viz3DEngine => {
  const engine = useContext(Viz3DContext);
  return engine ?? getViz3DEngine();
};
