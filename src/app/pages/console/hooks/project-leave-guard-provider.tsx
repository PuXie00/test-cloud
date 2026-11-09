import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePermissions } from "@/app/auth/permissions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { getSequenceContentRepairIssue } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { useActionBuilder } from "../components/action-builder/use-action-builder";
import { useSaveProject } from "./use-save-project";

/** 要离开当前工程：进工程管理（在里面可以换工程）、关闭工程、退出程序 */
export type ProjectLeaveReason = "manage" | "close" | "quit";

/** 有没保存的修改时先问；true = 可以继续（已保存或选了不保存），false = 留下 */
export type ConfirmProjectLeave = (reason: ProjectLeaveReason) => Promise<boolean>;

const ProjectLeaveGuardContext = createContext<ConfirmProjectLeave | null>(null);

const allowLeave: ConfirmProjectLeave = async () => true;

export const useConfirmProjectLeave = (): ConfirmProjectLeave =>
  useContext(ProjectLeaveGuardContext) ?? allowLeave;

const LEAVE_ACTION: Record<ProjectLeaveReason, string> = {
  manage: "进入工程管理",
  close: "关闭工程",
  quit: "退出",
};

const quoted = (names: readonly string[]): string => names.map((name) => `「${name}」`).join("");

/**
 * 离开当前工程（点菜单工程管理、关闭工程、点窗口 ✕ 退出）前：
 * 工程有没保存的修改、或有没保存的动作序列，先问保存 / 不保存 / 取消。
 */
export const ProjectLeaveGuardProvider = ({ children }: { children: ReactNode }) => {
  const { currentProject, isDirty } = useProject();
  const { sequences, draftSequenceIds, handleSaveAll } = useActionBuilder();
  const saveProject = useSaveProject();
  const { can } = usePermissions();
  const [reason, setReason] = useState<ProjectLeaveReason | null>(null);
  const [saving, setSaving] = useState(false);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const hasUnsaved = currentProject != null && (isDirty || draftSequenceIds.size > 0);
  const hasUnsavedRef = useRef(hasUnsaved);
  hasUnsavedRef.current = hasUnsaved;

  const settle = useCallback((ok: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setReason(null);
    resolve?.(ok);
  }, []);

  const confirmLeave = useCallback<ConfirmProjectLeave>((next) => {
    if (!hasUnsavedRef.current) return Promise.resolve(true);
    // 已经在问了（比如连点 ✕）：前一次算取消，弹窗换成这一次
    resolveRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setReason(next);
    });
  }, []);

  useEffect(() => () => resolveRef.current?.(false), []);

  // 窗口 ✕：有修改时主进程先不关，等这里确认
  useEffect(() => {
    if (!hasUnsaved) return;
    window.toolAPI?.setCloseGuard?.(true);
    return () => window.toolAPI?.setCloseGuard?.(false);
  }, [hasUnsaved]);

  useEffect(
    () =>
      window.toolAPI?.onCloseRequest?.(() => {
        void confirmLeave("quit").then((ok) => {
          if (ok) window.toolAPI?.confirmClose?.();
        });
      }),
    [confirmLeave],
  );

  const drafts = sequences.filter((item) => draftSequenceIds.has(item.id));
  const document = currentProject?.document;
  const blocked = document
    ? drafts.filter((item) => getSequenceContentRepairIssue(document, item)).map((item) => item.name)
    : [];
  const canSave = can("project.save");

  const handleSave = async () => {
    setSaving(true);
    try {
      let savedDrafts = false;
      if (drafts.length > 0) {
        const result = handleSaveAll();
        // 有动作正在运行、没保存上的（handleSaveAll 已提示）：留在弹窗，选不保存或取消
        if (result.running.length > 0) return;
        savedDrafts = result.saved > 0;
      }
      // 保存失败已提示，留在弹窗
      if ((isDirty || savedDrafts) && !(await saveProject())) return;
      settle(true);
    } finally {
      setSaving(false);
    }
  };

  const unsavedParts = [
    isDirty ? `工程「${currentProject?.name ?? ""}」有未保存的修改` : null,
    drafts.length > 0 ? `动作序列${quoted(drafts.map((item) => item.name))}还没保存` : null,
  ].filter((part): part is string => part !== null);

  return (
    <ProjectLeaveGuardContext.Provider value={confirmLeave}>
      {children}
      <AlertDialog
        open={reason !== null}
        onOpenChange={(open) => {
          if (!open && !saving) settle(false);
        }}
      >
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>{reason ? `${LEAVE_ACTION[reason]}前保存修改吗？` : null}</AlertDialogTitle>
            <AlertDialogDescription>
              {unsavedParts.join("，")}。不保存的话，这些修改会丢失。
            </AlertDialogDescription>
            {blocked.length > 0 ? (
              <p className="text-body-sm text-warning">{quoted(blocked)}待修复，保存不了</p>
            ) : null}
            {!canSave ? (
              <p className="text-body-sm text-muted-foreground">没有保存工程的权限</p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={() => settle(true)}
              className="border border-border bg-transparent text-foreground hover:bg-accent"
            >
              不保存
            </AlertDialogAction>
            <AlertDialogAction
              disabled={!canSave || saving}
              onClick={(event) => {
                event.preventDefault();
                void handleSave();
              }}
            >
              {saving ? "保存中…" : "保存"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ProjectLeaveGuardContext.Provider>
  );
};
