import { MousePointerClick, Play, SlidersVertical } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { useConsoleMode } from "../../../hooks/use-console-mode";

type ExecutorSectionKind = "cue" | "sequence";

type ExecutorSectionGuideProps = {
  kind: ExecutorSectionKind;
  className?: string;
};

const META: Record<
  ExecutorSectionKind,
  { title: string; subtitle: string; icon: typeof Play }
> = {
  cue: { title: "按键槽", subtitle: "Cue", icon: Play },
  sequence: { title: "推子槽", subtitle: "动作序列", icon: SlidersVertical },
};

export const ExecutorSectionGuide = ({ kind, className }: ExecutorSectionGuideProps) => {
  const { mode } = useConsoleMode();
  const { title, subtitle, icon: Icon } = META[kind];
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
          <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-label-caps text-foreground">{title}</p>
          <p className="text-body-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1 text-body-sm text-muted-foreground">
        {kind === "cue" ? (
          <>
            <p>{isRehearsal ? "" : "绑定 Cue 后点击 GO 触发执行。"}</p>
            <p className="flex items-center gap-1 text-body-sm">
              <MousePointerClick className="h-3 w-3 shrink-0 text-primary" aria-hidden />
              <span>单槽单 Cue，GO 即走</span>
            </p>
          </>
        ) : (
          <>
            <p>{isRehearsal ? "拖入动作序列到空槽，推子调节速度。" : "GO 启动序列，推子控制 0–200% 速率。"}</p>
            <p className="font-mono text-mono-sm tabular-nums text-foreground/80">默认 100%</p>
          </>
        )}
      </div>

      <p className="text-body-sm text-muted-foreground/80">
        {isRehearsal ? "排练可拖放编排" : "演出模式只执行"}
      </p>
    </div>
  );
};
