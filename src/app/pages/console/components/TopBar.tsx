import { Loader2, Menu, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { useAuth } from "@/app/auth/use-auth";
import { AppMenuPanel } from "@/app/components/ics/app-menu-panel";
import { EmergencyStopButton } from "@/app/components/ics/emergency-stop-button";
import { ProjectCenterDialog } from "@/app/components/project-center";
import { NewProjectDialog } from "@/app/components/project-center/new-project-dialog";
import { cn } from "@/app/components/ui/utils";
import {
  formatProjectHistoryAriaKeyshortcuts,
  formatProjectHistoryShortcutHint,
  resolveProjectHistoryShortcut,
} from "@/app/project/project-history-shortcuts";
import { useProject } from "@/app/project/use-project";
import { createDefaultSavedView } from "@/app/project/saved-view";
import { getViz3DEngine } from "@/app/viz3d";
import { isCppAckFailed } from "@shared/csocket/ack";
import { useConsoleMode } from "../hooks/use-console-mode";
import { usePlcRuntime } from "../hooks/plc-runtime-provider";
import { useProgram } from "../hooks/use-program";
import { useProjectStore } from "../hooks/use-project-store";
import { ShowModeConfirmDialog } from "./show-mode-confirm/show-mode-confirm-dialog";
import { ProjectMismatchDialog } from "./system-status/project-mismatch-dialog";
import { CollabDialog } from "./collaboration/collab-dialog";
import { CollabQuickPopover } from "./collaboration/collab-quick-popover";
import { PermissionsDialog } from "./permissions/permissions-dialog";
import { SystemSettingsDialog } from "./system-settings/system-settings-dialog";
import { useAlignmentChecklist } from "./drive-debug/alignment-checklist/alignment-checklist-provider";
import { AlignmentChecklistDialog } from "./drive-debug/alignment-checklist/alignment-checklist-dialog";
import { SystemStatusPopover } from "./system-status/system-status-popover";

type TopBarProps = {
  onStop: () => void;
  connected?: string;
};

const ghostBtn =
  "inline-flex h-10 items-center gap-2 rounded-md bg-transparent px-3 text-body-sm transition-colors hover:bg-muted";

const solidShowBtn =
  "inline-flex h-10 items-center gap-2 rounded-md px-3 text-body-sm font-medium transition-colors bg-show text-background hover:bg-show/90";

export const TopBar = ({
  onStop,
  connected = "24/24 Connected",
}: TopBarProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [projectCenterOpen, setProjectCenterOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [confirmDirection, setConfirmDirection] = useState<"enter" | "exit">("enter");
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const navigate = useNavigate();
  const { mode, isLocked, enterShow, exitShow, lock } = useConsoleMode();
  const { allConfirmed: alignmentConfirmed, openDialog: openAlignmentDialog, dialogOpen: alignmentDialogOpen } =
    useAlignmentChecklist();
  const [alignmentGateMessage, setAlignmentGateMessage] = useState<string | null>(null);
  const {
    currentProject,
    isDirty,
    isSaving,
    saveCurrentProject,
    saveProjectAs,
    closeProject,
    importProject,
    exportProject,
    canUndo,
    canRedo,
    undoProjectConfiguration,
    redoProjectConfiguration,
  } = useProject();
  const { plcs } = useProjectStore();
  const { shouldShowMismatchDialog, markMismatchDialogConsumed, systemStatus } =
    usePlcRuntime();
  const downloadPlcInFlightRef = useRef(false);

  useEffect(() => {
    if (!alignmentDialogOpen) setAlignmentGateMessage(null);
  }, [alignmentDialogOpen]);
  const { program } = useProgram();
  const projectName = currentProject?.name ?? "未选择工程";
  const projectLabel = isDirty && currentProject ? `${projectName}*` : projectName;
  const isShow = mode === "show";
  const undoEnabled = !isShow && canUndo;
  const redoEnabled = !isShow && canRedo;
  const undoShortcutHint = formatProjectHistoryShortcutHint("undo");
  const redoShortcutHint = formatProjectHistoryShortcutHint("redo");
  const undoAriaKeyshortcuts = formatProjectHistoryAriaKeyshortcuts("undo");
  const redoAriaKeyshortcuts = formatProjectHistoryAriaKeyshortcuts("redo");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveProjectHistoryShortcut(event);
      if (!action) return;
      const enabled = action === "undo" ? undoEnabled : redoEnabled;
      if (!enabled) return;
      event.preventDefault();
      const result =
        action === "undo"
          ? undoProjectConfiguration()
          : redoProjectConfiguration();
      if (!result.ok) toast.error(result.reason);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    redoEnabled,
    redoProjectConfiguration,
    undoEnabled,
    undoProjectConfiguration,
  ]);

  const handleLogout = () => {
    logout();
    setMenuOpen(false);
    navigate("/login", { replace: true });
  };

  const handleProjectManage = () => {
    setMenuOpen(false);
    setProjectCenterOpen(true);
  };

  const handleSaveProject = async () => {
    if (isSaving) return;
    try {
      const engine = getViz3DEngine();
      const view = engine.getSavedView() ?? createDefaultSavedView();
      const coverPngBase64 = engine.captureCoverPngBase64();
      await saveCurrentProject({ view, coverPngBase64 });
      toast.success("工程已保存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    }
  };

  const handleSaveProjectAs = () => {
    setSaveAsOpen(true);
  };

  const handleSaveAsConfirm = async (newName: string) => {
    try {
      await saveProjectAs(newName);
      toast.success(`已另存为「${newName}」`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "另存为失败");
      throw err;
    }
  };

  const handleCloseProject = async () => {
    try {
      await closeProject();
      navigate("/project-center", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "关闭失败");
    }
  };

  const handleDownloadPlcProject = async () => {
    if (downloadPlcInFlightRef.current) return;
    downloadPlcInFlightRef.current = true;
    markMismatchDialogConsumed();
    try {
      const result = await window.csocketApi.downloadPlcProject(
        plcs.map((plc) => ({ deviceId: plc.id })),
      );
      if (isCppAckFailed(result)) {
        toast.error(result.message ?? "下载失败");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "下载失败");
    } finally {
      downloadPlcInFlightRef.current = false;
    }
  };

  const handleImportExport = async () => {
    const doImport = await window.toolAPI.confirm({
      title: "导入 / 导出",
      message: "导入工程？",
      detail: "确定 = 导入，取消 = 导出当前工程",
      confirmLabel: "导入",
      cancelLabel: "导出",
    });
    try {
      if (doImport) {
        await importProject();
        toast.success("工程已导入");
        return;
      }
      const filePath = await exportProject();
      if (filePath) toast.success(`已导出：${filePath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败";
      if (message.includes("取消")) return;
      toast.error(message);
    }
  };

  const handleUndo = () => {
    if (!undoEnabled) return;
    const result = undoProjectConfiguration();
    if (!result.ok) toast.error(result.reason);
  };

  const handleRedo = () => {
    if (!redoEnabled) return;
    const result = redoProjectConfiguration();
    if (!result.ok) toast.error(result.reason);
  };

  const requestEnterShow = () => {
    if (!alignmentConfirmed) {
      setAlignmentGateMessage("进入演出模式前必须完成全部物理对齐确认。");
      openAlignmentDialog();
      toast.warning("未完成物理对齐确认，无法进入演出模式");
      return;
    }
    setConfirmDirection("enter");
    setConfirmOpen(true);
  };
  const requestExitShow = () => {
    setConfirmDirection("exit");
    setConfirmOpen(true);
  };
  const handleConfirm = () => {
    if (confirmDirection === "enter") enterShow();
    else exitShow();
    setConfirmOpen(false);
  };

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between bg-background px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label="打开应用菜单"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Menu className="h-4 w-4" />
          </button>
          <span className="font-medium text-foreground">YZDITEC</span>
          <span className="mx-1 text-border">/</span>
          <span
            className="truncate text-body-md font-medium text-foreground"
            title={
              isSaving
                ? "正在保存…"
                : isDirty && currentProject
                  ? "有未保存的修改"
                  : undefined
            }
            aria-label={
              isSaving
                ? `${projectName}（保存中）`
                : isDirty && currentProject
                  ? `${projectName}（未保存）`
                  : projectName
            }
          >
            {projectLabel}
          </span>
          {isSaving && (
            <Loader2
              className="h-3.5 w-3.5 shrink-0 animate-spin text-primary"
              aria-hidden
            />
          )}
        </div>

        {/* <div className="flex items-center gap-4">
          {!isShow ? (
            <button
              type="button"
              aria-label="演出模式"
              onClick={requestEnterShow}
              className={cn(ghostBtn, "text-show")}
            >
              <Play className="h-4 w-4 shrink-0" aria-hidden />
              <span>演出模式</span>
            </button>
          ) : (
            <button
              type="button"
              aria-label="退出演出模式"
              onClick={requestExitShow}
              className={solidShowBtn}
            >
              <Play className="h-4 w-4 shrink-0" aria-hidden />
              <span>退出演出模式</span>
            </button>
          )}
        </div> */}

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <SystemStatusPopover />
            {systemStatus.kind === "projectMismatch" ? (
              <button
                type="button"
                aria-label="下载当前工程到主控"
                onClick={() => void handleDownloadPlcProject()}
                className="inline-flex h-10 items-center rounded-md bg-primary px-3 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                下载
              </button>
            ) : null}
            {/* <CollabQuickPopover connected={connected} onOpenFullManage={() => setCollabOpen(true)} /> */}
            {/* <AlignmentStatusPill /> */}
          </div>
          <EmergencyStopButton onClick={onStop} />
        </div>
      </header>
      <AppMenuPanel
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        projectName={projectLabel}
        saveDisabled={isSaving}
        undoDisabled={!undoEnabled}
        redoDisabled={!redoEnabled}
        undoShortcutHint={undoShortcutHint}
        redoShortcutHint={redoShortcutHint}
        undoAriaKeyshortcuts={undoAriaKeyshortcuts}
        redoAriaKeyshortcuts={redoAriaKeyshortcuts}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onLogout={handleLogout}
        onProjectManage={handleProjectManage}
        onSaveProject={() => void handleSaveProject()}
        onSaveProjectAs={() => void handleSaveProjectAs()}
        onCloseProject={() => void handleCloseProject()}
        onVersionHistory={handleProjectManage}
        onImportExport={() => void handleImportExport()}
        showPermissions={isAdmin}
        onPermissionsConfig={() => setPermissionsOpen(true)}
        onCollabManage={() => setCollabOpen(true)}
        showSettings={!isShow}
        onSystemSettings={() => setSettingsOpen(true)}
        showLockScreen={!isLocked}
        onLockScreen={lock}
      />
      <ShowModeConfirmDialog
        open={confirmOpen}
        direction={confirmDirection}
        programName={program.name}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
      />
      <ProjectMismatchDialog
        open={shouldShowMismatchDialog}
        onCancel={markMismatchDialogConsumed}
        onCloseProject={() => void handleCloseProject()}
        onDownload={() => void handleDownloadPlcProject()}
      />
      <SystemSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <PermissionsDialog open={permissionsOpen} onOpenChange={setPermissionsOpen} />
      <CollabDialog open={collabOpen} onOpenChange={setCollabOpen} />
      <ProjectCenterDialog open={projectCenterOpen} onOpenChange={setProjectCenterOpen} />
      <NewProjectDialog
        open={saveAsOpen}
        onOpenChange={setSaveAsOpen}
        onCreate={handleSaveAsConfirm}
        title="另存为工程"
        submitLabel="另存为"
        defaultValue={`${currentProject?.name ?? "工程"}_副本`}
      />
      <AlignmentChecklistDialog gateMessage={alignmentGateMessage} />
    </>
  );
};
