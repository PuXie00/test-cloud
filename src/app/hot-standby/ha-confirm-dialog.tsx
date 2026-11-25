import { usePermissions } from "@/app/auth/permissions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import type { HaConfirmInfo } from "./ha-project-sync";

/** 写弹窗里的原因：哪边改过（方案 4.3） */
export const describeConfirmReason = (info: HaConfirmInfo): string[] => {
  const lines: string[] = [];
  if (info.noRecord) lines.push("本机第一次和主机同步这个工程（或者同步范围变了），两边的内容不一样。");
  if (info.standbyChanged) lines.push("本机在和主机断开期间改过工程。");
  if (info.unsavedOnRecord) {
    lines.push("上次断开时还有没保存的修改：主机重启过的话可能丢了，本机这里还留着。");
  }
  if (lines.length === 0) lines.push("两边的内容不一样。");
  return lines;
};

/**
 * 备机核对后两边不一样、又不能直接用主机的：问一次用哪边的（整份二选一）。
 * 没答之前不同步，备机只能停止、急停；不能关掉，要选一边。
 */
export const HaConfirmDialog = ({
  info,
  onChoose,
}: {
  info: HaConfirmInfo;
  onChoose: (choice: "primary" | "local") => void;
}) => {
  const canManage = usePermissions().can("collab.manage");
  return (
    <AlertDialog open>
      <AlertDialogContent className="bg-card" onEscapeKeyDown={(event) => event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>和主机（{info.primaryName}）的工程不一样</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-body-sm text-muted-foreground">
              {describeConfirmReason(info).map((line) => (
                <p key={line}>{line}</p>
              ))}
              <p>
                选一边的内容，另一边整份被覆盖；被覆盖的那边先自动存一个版本备份，选错了可以到版本备份里找回。
              </p>
              <p className="text-warning">选好之前不同步，本机只能停止、急停。</p>
              {!canManage ? (
                <p role="alert" className="text-destructive">
                  当前用户没有「主备热备」权限，请有权限的用户来选。
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            disabled={!canManage}
            onClick={() => onChoose("local")}
            className="h-10 border border-border bg-transparent text-foreground hover:bg-muted/50"
          >
            用本机的
          </AlertDialogAction>
          <AlertDialogAction disabled={!canManage} onClick={() => onChoose("primary")} className="h-10">
            用主机的
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
