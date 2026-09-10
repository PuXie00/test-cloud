import { useEffect } from "react";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useActionPreviewPoses } from "./use-action-preview-poses";
import { useViz3DContext } from "./Viz3DProvider";

export const Viz3DActionPreviewSync = () => {
  const engine = useViz3DContext();
  const { activeNav } = useConsoleNav();
  const poses = useActionPreviewPoses();

  useEffect(() => {
    if (activeNav !== "sequences" || poses.size === 0) {
      return;
    }

    for (const [id, pose] of poses) {
      engine.applyVirtualAxisPose(String(id), pose);
    }
  }, [activeNav, poses, engine]);

  return null;
};
