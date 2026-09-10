import { cn } from "@/app/components/ui/utils";

type ShowModeConfirmDialogProps = {
  open: boolean;
  direction: "enter" | "exit";
  programName: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export const ShowModeConfirmDialog = ({
  open,
  direction,
  programName,
  onCancel,
  onConfirm,
}: ShowModeConfirmDialogProps) => {
  if (!open) return null;
  const isEnter = direction === "enter";
  return (
    <div className={cn("fixed inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm")}>
      <div className="w-[420px] rounded-md border border-border bg-card p-5 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        <h2 className="text-heading-md font-semibold text-foreground">
          {isEnter ? "进入演出模式" : "退出演出模式"}
        </h2>
        <p className="mt-2 text-body-sm text-muted-foreground">
          {isEnter
            ? "进入演出模式后将隐藏配置入口与右栏手动控制，启用锁屏入口。"
            : "退出演出模式将恢复编辑入口与手动控制 Tab。"}
        </p>
        <p className="mt-2 text-body-sm text-foreground">
          已选择的演出节目: <span className="font-mono">{programName}</span>
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-sm border border-border bg-background px-4 text-body-md text-foreground hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-10 rounded-sm bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {isEnter ? "确认进入" : "确认退出"}
          </button>
        </div>
      </div>
    </div>
  );
};
