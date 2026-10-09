import { useEffect } from "react";
import { useBuildDebugOptional } from "@/app/pages/console/components/build-debug/build-debug-context";
import { useControlledObjects } from "../hooks/use-controlled-objects";
import { useProjectStore } from "../hooks/use-project-store";
import { hoistTravelInputs } from "./hoist-travel-inputs";
import { useViz3DContext } from "./Viz3DProvider";

/** 搭建调试 tab 打开时按电机实时位置显示吊点粗线 / 表盘指针；吊点本身不动 */
export const Viz3DHoistTravelSync = () => {
  const engine = useViz3DContext();
  const armed = useBuildDebugOptional()?.armed ?? false;
  const { motors } = useProjectStore();
  const { motorSnapshots } = useControlledObjects();

  useEffect(() => {
    if (!armed) return;
    engine.setHoistTravel(hoistTravelInputs(motors, motorSnapshots));
  }, [engine, armed, motors, motorSnapshots]);

  useEffect(() => {
    if (!armed) return;
    return () => engine.clearHoistTravel();
  }, [engine, armed]);

  return null;
};
