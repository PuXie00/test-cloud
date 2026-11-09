import { useCallback } from "react";
import { toast } from "sonner";
import { usePermissions } from "@/app/auth/permissions";
import { createDefaultSavedView } from "@/app/project/saved-view";
import { useProject } from "@/app/project/use-project";
import { getViz3DEngine } from "@/app/viz3d";
import { writeConfigOperationLog } from "./write-operation-log";

/** 保存工程文件：带上当前 3D 视角和封面，记操作日志、提示结果；保存成功返回 true */
export const useSaveProject = (): (() => Promise<boolean>) => {
  const { currentProject, isSaving, saveCurrentProject } = useProject();
  const { can } = usePermissions();
  const projectName = currentProject?.name ?? "未选择工程";

  return useCallback(async () => {
    if (isSaving || !can("project.save")) return false;
    try {
      const engine = getViz3DEngine();
      const view = engine.getSavedView() ?? createDefaultSavedView();
      const coverPngBase64 = engine.captureCoverPngBase64();
      await saveCurrentProject({ view, coverPngBase64 });
      writeConfigOperationLog("saveProject", `保存工程「${projectName}」`);
      toast.success("工程已保存");
      return true;
    } catch (err) {
      writeConfigOperationLog("saveProject", `保存工程「${projectName}」`, err);
      toast.error(err instanceof Error ? err.message : "保存失败");
      return false;
    }
  }, [can, isSaving, projectName, saveCurrentProject]);
};
