import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { useProject } from "@/app/project/use-project";
import type { ProjectVersionEntry } from "@/app/project/project-types";
import { NewProjectDialog } from "./new-project-dialog";
import { ProjectCardGrid } from "./project-card-grid";
import { ProjectCenterHeader } from "./project-center-header";
import { ProjectDetailSidebar } from "./project-detail-sidebar";

type ProjectCenterScreenProps = {
  /** page = 独立路由页；overlay = Console 内全屏弹窗 */
  presentation?: "page" | "overlay";
  onDismiss?: () => void;
};

export const ProjectCenterScreen = ({
  presentation = "page",
  onDismiss,
}: ProjectCenterScreenProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isOverlay = presentation === "overlay";
  const {
    currentProject,
    filteredProjects,
    selectedProject,
    selectedProjectId,
    setSelectedProjectId,
    openProject,
    createProject,
    saveProjectAs,
    deleteProject,
    importProject,
    exportProject,
    refreshHistory,
    restoreVersion,
    loading,
    error,
    searchQuery,
    setSearchQuery,
  } = useProject();

  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (currentProject) setSelectedProjectId(currentProject.id);
  }, [location.pathname, currentProject?.id, setSelectedProjectId]);

  useEffect(() => {
    if (filteredProjects.length === 0) return;
    const stillVisible = filteredProjects.some((p) => p.id === selectedProjectId);
    if (!stillVisible) setSelectedProjectId(filteredProjects[0].id);
  }, [searchQuery, filteredProjects, selectedProjectId, setSelectedProjectId]);

  useEffect(() => {
    if (!selectedProject?.folderName) return;
    void refreshHistory(selectedProject.folderName).catch(() => {
      // 列表历史失败不打断主流程
    });
  }, [selectedProject?.folderName, refreshHistory]);

  const handleBack = () => {
    if (isOverlay) {
      onDismiss?.();
      return;
    }
    navigate("/console", { replace: true });
  };

  const handleOpenProject = async () => {
    if (!selectedProject || selectedProject.status === "archived" || opening) return;
    setOpening(true);
    try {
      const result = await openProject(selectedProject.folderName);
      // if (result.ok)
      if (isOverlay) {
        onDismiss?.();
        return;
      }
      navigate("/console", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "打开工程失败");
    } finally {
      setOpening(false);
    }
  };

  const handleCreate = async (name: string) => {
    await createProject(name);
    toast.success(`已创建工程「${name}」`);
  };

  const handleImport = async () => {
    try {
      await importProject();
      toast.success("工程已导入");
    } catch (err) {
      const message = err instanceof Error ? err.message : "导入失败";
      if (message.includes("取消")) return;
      toast.error(message);
    }
  };

  const handleExport = async () => {
    if (!selectedProject) return;
    try {
      const filePath = await exportProject(selectedProject.folderName);
      if (filePath) toast.success(`已导出：${filePath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "导出失败";
      if (message.includes("取消")) return;
      toast.error(message);
    }
  };

  const handleDelete = async () => {
    if (!selectedProject) return;
    const ok = await window.toolAPI.confirm({
      title: "删除工程",
      message: `确认删除工程「${selectedProject.name}」？`,
      detail: "此操作不可恢复。",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteProject(selectedProject.folderName);
      toast.success("工程已删除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const handleSaveAs = async (newName: string) => {
    if (!selectedProject) return;
    try {
      if (currentProject?.folderName !== selectedProject.folderName) {
        await openProject(selectedProject.folderName);
      }
      await saveProjectAs(newName);
      toast.success(`已另存为「${newName}」`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "另存为失败");
      throw err;
    }
  };

  const handleRestore = async (entry: ProjectVersionEntry) => {
    if (!entry.historyId || !selectedProject) return;
    const ok = await window.toolAPI.confirm({
      title: "恢复版本",
      message: `确认恢复到「${entry.version}」？`,
      detail: "当前配置将先自动备份。",
    });
    if (!ok) return;
    try {
      if (currentProject?.folderName !== selectedProject.folderName) {
        await openProject(selectedProject.folderName);
      }
      await restoreVersion(entry.historyId);
      toast.success(`已恢复版本「${entry.version}」`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复失败");
    }
  };

  const showBack = isOverlay || !!currentProject;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
      <ProjectCenterHeader
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showBack={showBack}
        backLabel={isOverlay ? "关闭" : "返回控制台"}
        onBack={handleBack}
        onOpenFile={() => void handleImport()}
        onNewProject={() => setNewDialogOpen(true)}
      />

      {(loading || error) && (
        <div className="shrink-0 bg-muted px-6 py-2 text-center text-body-sm text-muted-foreground">
          {loading ? "正在加载本地工程…" : error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden p-6">
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
            {!loading && filteredProjects.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">暂无工程，请新建或导入</p>
            ) : (
              <ProjectCardGrid
                projects={filteredProjects}
                selectedId={selectedProject?.id ?? null}
                onSelect={setSelectedProjectId}
              />
            )}
          </div>
        </div>
        <ProjectDetailSidebar
          project={selectedProject}
          opening={opening}
          onOpen={() => void handleOpenProject()}
          onSaveAs={() => setSaveAsOpen(true)}
          onExport={() => void handleExport()}
          onDelete={() => void handleDelete()}
          onRestore={(entry) => void handleRestore(entry)}
        />
      </div>

      <NewProjectDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onCreate={handleCreate}
      />
      <NewProjectDialog
        open={saveAsOpen}
        onOpenChange={setSaveAsOpen}
        onCreate={handleSaveAs}
        title="另存为副本"
        submitLabel="另存为"
      />
    </div>
  );
};
