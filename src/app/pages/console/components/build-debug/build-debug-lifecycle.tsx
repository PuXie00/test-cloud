import { useEffect } from "react";
import { useConsoleMode } from "@/app/pages/console/hooks/use-console-mode";
import { useConsoleNav } from "@/app/pages/console/hooks/use-console-nav";
import { useProject } from "@/app/project/use-project";
import { useBuildDebug } from "@/app/pages/console/components/build-debug/build-debug-context";

/** 离搭建 / 演出 / 关工程自动 disarm（调试 tab 卸载时也会 disarm） */
export const BuildDebugLifecycle = () => {
  const { activeNav } = useConsoleNav();
  const { mode } = useConsoleMode();
  const { currentProject } = useProject();
  const { armed, disarm } = useBuildDebug();

  useEffect(() => {
    const leaveBuild = activeNav !== "devices" || mode === "show" || !currentProject;
    if (leaveBuild && armed) {
      disarm();
    }
  }, [activeNav, mode, currentProject, armed, disarm]);

  return null;
};
