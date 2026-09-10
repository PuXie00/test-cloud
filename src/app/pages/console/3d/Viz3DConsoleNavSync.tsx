import { useEffect } from "react";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useViz3DContext } from "./Viz3DProvider";

export const Viz3DConsoleNavSync = () => {
  const engine = useViz3DContext();
  const { activeNav } = useConsoleNav();

  useEffect(() => {
    const sceneEditEnabled = activeNav === "devices";
    engine.setSceneEditEnabled(sceneEditEnabled);
    if (!sceneEditEnabled) {
      // 非搭建界面：强制 select；setMode 会 teardown gizmo（即使已是 select 也再次隐藏 helper）
      engine.setMode("select");
    }
  }, [activeNav, engine]);

  return null;
};
