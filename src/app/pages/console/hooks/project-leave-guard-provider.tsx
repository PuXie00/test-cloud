import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { localActiveRuns, type LocalActiveRuns } from "./exec-card-run-status";
import { useExecCards } from "./use-exec-cards";
import { useSaveProject } from "./use-save-project";

/** 要离开当前工程：进工程管理（在里面可以换工程）、关闭工程、退出程序、安装升级（软件会退出） */
export type ProjectLeaveReason = "manage" | "close" | "quit" | "update";

/** 本机有动作在运行时不让走（先停）；有没保存的修改时先问；true = 可以继续（已保存或选了不保存），false = 留下 */
export type ConfirmProjectLeave = (reason: ProjectLeaveReason) => Promise<boolean>;

const ProjectLeaveGuardContext = createContext<ConfirmProjectLeave | null>(null);

const allowLeave: ConfirmProjectLeave = async () => true;

export const useConfirmProjectLeave = (): ConfirmProjectLeave =>
  useContext(ProjectLeaveGuardContext) ?? allowLeave;

const LEAVE_ACTION: Record<ProjectLeaveReason, string> = {
  manage: "进入工程管理",
  close: "关闭工程",
  quit: "退出",
  update: "安装升级",
};

const quoted = (names: readonly string[]): string => names.map((name) => `「${name}」`).join("");

const hasRuns = (runs: LocalActiveRuns): boolean => runs.running.length > 0 || runs.stopping.length > 0;

/** 「有动作正在运行」的说明：运行中（含暂停）的要先停，停止中的等停稳 */
export const runningBlockText = (runs: LocalActiveRuns, reason: ProjectLeaveReason): string => {
  const action = LEAVE_ACTION[reason];
  const { running, stopping } = runs;
  if (running.length > 0 && stopping.length > 0) {
    return `${quoted(running)}正在运行，${quoted(stopping)}正在停止，请先停止、等动作停稳后再${action}。`;
  }
  if (running.length > 0) return `${quoted(running)}正在运行，请先停止再${action}。`;
  return `${quoted(stopping)}正在停止，停稳后再${action}。`;
};

/**
 * 离开当前工程（点菜单工程管理、关闭工程、点窗口 ✕ 退出）前：
 * 本机有动作在运行（来源不是「外部」的任务卡，见 localActiveRuns）时不让走，提示先停止；
 * 工程有没保存的修改、或有没保存的动作序列，先问保存 / 不保存 / 取消。
 * 热备时只看本机启动的：另一台在运行的动作不拦本机退出、切工程。
 */
export const ProjectLeaveGuardProvider = ({ children }: { children: ReactNode }) => {
  const { currentProject, isDirty } = useProject();
  const { sequences, draftSequenceIds, handleSaveAll } = useActionBuilder();
  const saveProject = useSaveProject();
  const { can } = usePermissions();
  const [reason, setReason] = useState<ProjectLeaveReason | null>(null);
  const [saving, setSaving] = useState(false);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);
  const [runningBlock, setRunningBlock] = useState<{ reason: ProjectLeaveReason; runs: LocalActiveRuns } | null>(
    null,
  );

  // 任务卡运行时每帧都在变；只在运行中 / 停止中的动作有变化时换新值
  const { cards } = useExecCards();
  const runsKey = JSON.stringify(localActiveRuns(cards));
  const localRuns = useMemo<LocalActiveRuns>(() => JSON.parse(runsKey) as LocalActiveRuns, [runsKey]);
  const localRunsRef = useRef(localRuns);
  localRunsRef.current = localRuns;
  const running = hasRuns(localRuns);

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
    const runs = localRunsRef.current;
    if (hasRuns(runs)) {
      // 先停再走：不问保存，正在问的也算取消
      resolveRef.current?.(false);
      resolveRef.current = null;
      setReason(null);
      setRunningBlock({ reason: next, runs });
      return Promise.resolve(false);
    }
    if (!hasUnsavedRef.current) return Promise.resolve(true);
    // 已经在问了（比如连点 ✕）：前一次算取消，弹窗换成这一次
    resolveRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setReason(next);
    });
  }, []);

  useEffect(() => () => resolveRef.current?.(false), []);

  // 窗口 ✕：有修改、或本机有动作在运行时主进程先不关，等这里确认
  const guardClose = hasUnsaved || running;
  useEffect(() => {
    if (!guardClose) return;
    window.toolAPI?.setCloseGuard?.(true);
    return () => window.toolAPI?.setCloseGuard?.(false);
  }, [guardClose]);

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
      <AlertDialog
        open={runningBlock !== null}
        onOpenChange={(open) => {
          if (!open) setRunningBlock(null);
        }}
      >
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>有动作正在运行</AlertDialogTitle>
            <AlertDialogDescription>
              {runningBlock ? runningBlockText(runningBlock.runs, runningBlock.reason) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>知道了</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ProjectLeaveGuardContext.Provider>
  );
};
