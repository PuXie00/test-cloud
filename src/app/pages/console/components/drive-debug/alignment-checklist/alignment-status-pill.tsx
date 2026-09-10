import { CheckCircle2, ClipboardCheck } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { useAlignmentChecklist } from "./alignment-checklist-provider";

export const AlignmentStatusPill = () => {
  const { allConfirmed, openDialog, confirmedCount, totalCount } = useAlignmentChecklist();

  return (
    <button
      type="button"
      onClick={openDialog}
      aria-label="物理对齐清单"
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-body-sm transition-colors",
        allConfirmed
          ? "bg-show/10 text-show hover:bg-show/20"
          : "bg-warning/10 text-warning hover:bg-warning/20",
      )}
    >
      {allConfirmed ? (
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <ClipboardCheck className="h-4 w-4 shrink-0" aria-hidden />
      )}
      <span>{allConfirmed ? "已对齐" : `未对齐 ${confirmedCount}/${totalCount}`}</span>
    </button>
  );
};
