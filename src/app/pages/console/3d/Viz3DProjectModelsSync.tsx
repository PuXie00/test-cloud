import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useProject } from "@/app/project/use-project";
import { useProjectStore } from "../hooks/use-project-store";
import { ensureProjectModelsLoaded } from "./ensure-project-models";
import { useViz3DContext } from "./Viz3DProvider";

export const Viz3DProjectModelsSync = () => {
  const engine = useViz3DContext();
  const { currentProject } = useProject();
  const { objects } = useProjectStore();
  const projectKey = currentProject?.folderName ?? null;
  // 主备热备：另一台发来模型文件后再载一次（配置可能先到，文件后到）
  const [modelsRevision, setModelsRevision] = useState(0);
  useEffect(() => window.haAPI?.onModelsChanged?.(() => setModelsRevision((value) => value + 1)), []);

  // Clear model templates on project close, switch, or unmount.
  useEffect(() => {
    if (!projectKey) {
      engine.clearModels();
    }
    return () => {
      engine.clearModels();
    };
  }, [engine, projectKey]);

  useEffect(() => {
    if (!currentProject) {
      return;
    }

    const modelIds = objects
      .map((object) => object.modelId)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0);

    let cancelled = false;
    void ensureProjectModelsLoaded(modelIds, engine).then(({ failed }) => {
      if (cancelled || failed.length === 0) {
        return;
      }
      toast.error(`${failed.length} 个外部模型加载失败`);
    });

    return () => {
      cancelled = true;
    };
  }, [engine, currentProject, objects, modelsRevision]);

  return null;
};
