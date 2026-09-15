import { SlidersVertical } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { useConsoleMode } from "../../../hooks/use-console-mode";

type ExecutorSectionGuideProps = {
  className?: string;
};

export const ExecutorSectionGuide = ({ className }: ExecutorSectionGuideProps) => {
  const { mode } = useConsoleMode();
  const isRehearsal = mode === "rehearsal";

  return (
    <div
      className={cn(
        "flex w-[96px] shrink-0 flex-col gap-1.5 rounded-sm border border-border bg-card p-2",
        className,
      )}
    >
      <div className="flex items-start gap-1.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-muted">
          <SlidersVertical className="h-3.5 w-3.5 text-primary" aria-hidden />
        </div>
        <p className="min-w-0 text-label-caps text-foreground">推子槽</p>
      </div>
      <p className="text-body-sm text-muted-foreground">{isRehearsal ? "拖入序列" : "推子调速"}</p>
    </div>
  );
};
