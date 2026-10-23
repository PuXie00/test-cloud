import { useEffect, useState } from "react";
import type { Viz3DEngine } from "@/app/viz3d";

/**
 * 引擎异步初始化完成前推给它的标签 / 遥测会被丢掉；每次 ready 版本号 +1，
 * 放进 effect 依赖里让同步组件重推一次。等 React 重渲染后再推，物体已由 Viz3DObjectSync 建好。
 */
export const useViz3DReadyVersion = (engine: Viz3DEngine): number => {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handleReady = () => setVersion((value) => value + 1);
    engine.events.on("ready", handleReady);
    return () => {
      engine.events.off("ready", handleReady);
    };
  }, [engine]);

  return version;
};
