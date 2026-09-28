import { useEffect } from "react";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useSequencePreview } from "../hooks/use-sequence-preview";
import { useActionPreviewPoses } from "./use-action-preview-poses";
import { useViz3DContext } from "./Viz3DProvider";

export const Viz3DActionPreviewSync = () => {
  const engine = useViz3DContext();
  const { activeNav } = useConsoleNav();
  const { sequenceId: programPreviewId } = useSequencePreview();
  const poses = useActionPreviewPoses();

  useEffect(() => {
    if (activeNav !== "sequences" || programPreviewId !== null || poses.size === 0) {
      return;
    }

    for (const [id, pose] of poses) {
      engine.applyVirtualAxisPose(String(id), pose);
    }
  }, [activeNav, programPreviewId, poses, engine]);

  return null;
};
