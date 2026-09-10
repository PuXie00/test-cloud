import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/components/ui/utils";
import {
  COUPLE_DEVIATION_BLOCKED,
  COUPLE_MOTION_WARNING,
  COUPLE_SOLVE_TIMEOUT,
  COUPLE_SOLVE_TIMEOUT_HINT,
  type CouplePreviewResult,
} from "../../../hooks/couple-preview";

type CouplePreviewDialogProps = {
  open: boolean;
  preview: CouplePreviewResult | null;
  onCancel: () => void;
  onConfirm: () => void;
};

const cellClass = "border border-border/60 px-3 py-2";

export const CouplePreviewDialog = ({
  open,
  preview,
  onCancel,
  onConfirm,
}: CouplePreviewDialogProps) => {
  const rows = preview?.rows ?? [];
  const nameSpans = rows.map((row, index) => {
    if (index > 0 && rows[index - 1]?.objectId === row.objectId) return 0;
    let span = 1;
    while (rows[index + span]?.objectId === row.objectId) span += 1;
    return span;
  });
  const hasFooterCopy =
    Boolean(preview?.timedOut) ||
    preview?.footer === "motion-warning" ||
    preview?.footer === "deviation-blocked";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="max-w-3xl overflow-hidden border-0 bg-card p-0 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        <DialogHeader className="bg-muted px-4 py-3 text-left">
          <DialogTitle className="text-heading-md">耦合对照</DialogTitle>
          <DialogDescription className="text-body-sm text-muted-foreground">
            确认后才向设备下发耦合指令
          </DialogDescription>
        </DialogHeader>

        <div className="bg-background p-4">
          <div className="bg-muted">
            <table className="w-full border-collapse text-body-sm">
              <thead>
                <tr className="text-left text-label-caps text-muted-foreground">
                  <th className={cn(cellClass, "font-medium")}>物体</th>
                  <th className={cn(cellClass, "font-medium")}>电机索引</th>
                  <th className={cn(cellClass, "font-medium")}>当前位置</th>
                  <th className={cn(cellClass, "font-medium")}>目标位置</th>
                  <th className={cn(cellClass, "font-medium")}>偏差</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={`${row.objectId}-${row.motorId}-${index}`}
                    className={cn(
                      "bg-accent",
                      row.highlight && "text-destructive",
                    )}
                  >
                    {nameSpans[index] ? (
                      <td
                        className={cn(cellClass, "align-middle text-foreground")}
                        rowSpan={nameSpans[index]}
                      >
                        {row.objectName}
                      </td>
                    ) : null}
                    <td className={cn(cellClass, "font-mono text-mono-sm tabular-nums")}>
                      {row.motorId}
                    </td>
                    <td className={cn(cellClass, "font-mono text-mono-sm tabular-nums")}>
                      {row.currentMm}
                    </td>
                    <td className={cn(cellClass, "font-mono text-mono-sm tabular-nums")}>
                      {row.targetMm}
                    </td>
                    <td className={cn(cellClass, "font-mono text-mono-sm tabular-nums")}>
                      {row.deviationMm}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter className="flex flex-row items-center justify-between gap-3 bg-muted px-4 py-3 sm:flex-row sm:justify-between sm:space-x-0">
          <div className="min-w-0 flex-1 space-y-1">
            {preview?.timedOut ? (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="inline-flex items-center rounded-md bg-warning-surface px-2 py-0.5 text-body-sm text-warning">
                  {COUPLE_SOLVE_TIMEOUT}
                </span>
                <span className="text-[11px] leading-4 text-warning">
                  {COUPLE_SOLVE_TIMEOUT_HINT}
                </span>
              </div>
            ) : null}
            {preview?.footer === "motion-warning" ? (
              <p className="text-body-sm text-warning">{COUPLE_MOTION_WARNING}</p>
            ) : null}
            {preview?.footer === "deviation-blocked" ? (
              <p className="text-body-sm font-semibold text-destructive">{COUPLE_DEVIATION_BLOCKED}</p>
            ) : null}
            {!hasFooterCopy ? <span className="sr-only">无附加提示</span> : null}
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            <button
              type="button"
              className="h-10 rounded-md border border-border bg-transparent px-4 text-body-sm text-foreground"
              onClick={onCancel}
            >
              取消
            </button>
            <button
              type="button"
              disabled={!preview?.confirmEnabled}
              className="h-10 rounded-md bg-primary px-4 text-body-sm font-semibold text-primary-foreground disabled:opacity-40"
              onClick={onConfirm}
            >
              确认
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
