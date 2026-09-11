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
        "flex w-[148px] shrink-0 flex-col gap-1.5 rounded-sm border border-border bg-card p-2",
        className,
      )}
    >
      <div className="flex items-start gap-1.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-muted">
          <SlidersVertical className="h-3.5 w-3.5 text-primary" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-label-caps text-foreground">推子槽</p>
          <p className="text-body-sm text-muted-foreground">动作序列</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1 text-body-sm text-muted-foreground">
        <p>
          {isRehearsal
            ? "拖入动作序列到空槽，推子调节速度。"
            : "GO 启动序列，推子控制 0–200% 速率。"}
        </p>
        <p className="font-mono text-mono-sm tabular-nums text-foreground/80">默认 100%</p>
      </div>

      <p className="text-body-sm text-muted-foreground/80">
        {isRehearsal ? "排练可拖放编排" : "演出模式只执行"}
      </p>
    </div>
  );
};
