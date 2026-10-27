import { useEffect } from "react";
import { usePermissions } from "@/app/auth/permissions";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useViz3DContext } from "./Viz3DProvider";

export const Viz3DConsoleNavSync = () => {
  const engine = useViz3DContext();
  const { activeNav } = useConsoleNav();
  // 3D 里移动 / 旋转物体要「编辑工程配置」；只读时搭建页也只能选中查看
  const canEdit = usePermissions().can("build.edit");

  useEffect(() => {
    const sceneEditEnabled = activeNav === "devices" && canEdit;
    engine.setSceneEditEnabled(sceneEditEnabled);
    if (!sceneEditEnabled) {
      // 非搭建界面：强制 select；setMode 会 teardown gizmo（即使已是 select 也再次隐藏 helper）
      engine.setMode("select");
    }
  }, [activeNav, canEdit, engine]);

  return null;
};
