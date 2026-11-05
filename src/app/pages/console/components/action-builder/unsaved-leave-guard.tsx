import { useEffect, useState, type MutableRefObject } from "react";
import { getSequenceContentRepairIssue } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
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
import { useAxisMotionLocks } from "../../hooks/axis-motion";
import { useActionBuilder } from "./use-action-builder";

/** 要离开动作页时调用：有未保存的序列就弹窗、返回 true（之后由弹窗决定要不要继续）；没有返回 false */
export type UnsavedLeaveGuard = (proceed: () => void) => boolean;

const quoted = (names: readonly string[]): string => names.map((name) => `「${name}」`).join("");

/**
 * 离开动作页的提醒：有没保存的动作序列时拦一下，可以全部保存后离开、暂不保存（草稿留在内存里）或留下。
 * 单独一个组件订阅动作编辑的状态，免得整个控制台跟着播放头重渲染。
 */
export const UnsavedLeaveGuard = ({
  guardRef,
}: {
  guardRef: MutableRefObject<UnsavedLeaveGuard | null>;
}) => {
  const { sequences, draftSequenceIds, handleSaveAll } = useActionBuilder();
  const document = useProject().currentProject?.document;
  // 轴运动中保存不了：按下「全部保存」时提示（handleSaveAll），弹窗留着选暂不保存或取消
  const motionLocked = useAxisMotionLocks().action !== null;
  const [proceed, setProceed] = useState<(() => void) | null>(null);

  useEffect(() => {
    guardRef.current = (next) => {
      if (draftSequenceIds.size === 0) return false;
      setProceed(() => next);
      return true;
    };
    return () => {
      guardRef.current = null;
    };
  }, [guardRef, draftSequenceIds]);

  const drafts = sequences.filter((item) => draftSequenceIds.has(item.id));
  const blocked = document
    ? drafts.filter((item) => getSequenceContentRepairIssue(document, item)).map((item) => item.name)
    : [];
  const savable = drafts.length - blocked.length;

  const leave = () => {
    const next = proceed;
    setProceed(null);
    next?.();
  };

  return (
    <AlertDialog open={proceed !== null} onOpenChange={(open) => !open && setProceed(null)}>
      <AlertDialogContent className="bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle>有 {drafts.length} 个动作序列未保存</AlertDialogTitle>
          <AlertDialogDescription>
            {quoted(drafts.map((item) => item.name))}
            的修改还没保存，节目和执行用的仍是上次保存的版本。暂不保存时草稿会保留，回到动作页可以继续编辑。
          </AlertDialogDescription>
          {blocked.length > 0 ? (
            <p className="text-body-sm text-warning">{quoted(blocked)}待修复，不能保存</p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={leave}
            className="border border-border bg-transparent text-foreground hover:bg-accent"
          >
            暂不保存
          </AlertDialogAction>
          <AlertDialogAction
            disabled={savable === 0}
            onClick={(event) => {
              handleSaveAll();
              if (motionLocked) event.preventDefault();
              else leave();
            }}
          >
            {blocked.length > 0 ? `保存其余 ${savable} 个` : "全部保存"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
