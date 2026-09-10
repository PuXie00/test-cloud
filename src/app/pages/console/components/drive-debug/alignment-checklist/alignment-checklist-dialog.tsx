import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { Checkbox } from "@/app/components/ui/checkbox";
import { useAlignmentChecklist } from "./alignment-checklist-provider";

const formatTime = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

type AlignmentChecklistDialogProps = {
  gateMessage?: string | null;
};

export const AlignmentChecklistDialog = ({ gateMessage }: AlignmentChecklistDialogProps) => {
  const {
    items,
    state,
    dialogOpen,
    closeDialog,
    confirmItem,
    unconfirmItem,
    confirmAll,
    allConfirmed,
    confirmedCount,
    totalCount,
  } = useAlignmentChecklist();

  if (!dialogOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-[520px] max-w-[92vw] flex-col rounded-lg border border-border bg-card shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        <div className="flex items-center justify-between bg-muted px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-heading-md font-semibold text-foreground">物理对齐清单</span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label-caps",
                allConfirmed ? "bg-show/15 text-show" : "bg-warning/15 text-warning",
              )}
            >
              {confirmedCount}/{totalCount} 已确认
            </span>
          </div>
          <button
            type="button"
            onClick={closeDialog}
            aria-label="关闭"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {gateMessage && (
          <div className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-body-sm text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {gateMessage}
          </div>
        )}
        {!gateMessage && !allConfirmed && (
          <div className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-body-sm text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            当前工程未完成物理对齐确认，完成调试回写后请重新核对现场状态。
          </div>
        )}

        <div className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto bg-background p-4">
          <p className="text-body-sm text-muted-foreground">
            每次打开工程需人工逐项确认物理世界与软件配置一致。确认信息将记录确认人与时间。
          </p>
          {items.map((item) => {
            const record = state[item.id];
            return (
              <label
                key={item.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md bg-input-background p-3 transition-colors",
                  record.confirmed && "ring-1 ring-show/40",
                )}
              >
                <Checkbox
                  checked={record.confirmed}
                  onCheckedChange={(checked) =>
                    checked === true ? confirmItem(item.id) : unconfirmItem(item.id)
                  }
                  aria-label={item.label}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-body-md text-foreground">
                    {record.confirmed && <CheckCircle2 className="h-3.5 w-3.5 text-show" aria-hidden />}
                    {item.label}
                  </p>
                  <p className="text-body-sm text-muted-foreground">{item.description}</p>
                  {record.confirmed && (
                    <p className="mt-1 font-mono text-mono-sm text-muted-foreground">
                      {record.confirmedBy} · {formatTime(record.confirmedAt)}
                    </p>
                  )}
                </div>
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 bg-muted px-4 py-3">
          <button
            type="button"
            onClick={confirmAll}
            className="h-10 rounded-md border border-border bg-transparent px-4 text-body-sm text-foreground hover:bg-accent"
          >
            全部确认
          </button>
          <button
            type="button"
            onClick={closeDialog}
            className={cn(
              "h-10 rounded-md px-4 text-body-sm font-semibold",
              allConfirmed
                ? "bg-show text-background hover:opacity-90"
                : "bg-primary text-primary-foreground hover:opacity-90",
            )}
          >
            {allConfirmed ? "已全部对齐 · 完成" : "稍后再确认"}
          </button>
        </div>
      </div>
    </div>
  );
};
