import { Circle, Pause } from "lucide-react";
import { cn } from "@/app/components/ui/utils";

type LogToolbarProps = {
  liveTail: boolean;
  onToggleLiveTail: () => void;
};

export const LogToolbar = ({ liveTail, onToggleLiveTail }: LogToolbarProps) => (
  <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
    <button
      type="button"
      onClick={onToggleLiveTail}
      aria-pressed={liveTail}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-sm border px-1.5 text-label-caps",
        liveTail
          ? "border-destructive/50 text-destructive"
          : "border-border text-muted-foreground"
      )}
    >
      {liveTail ? <Circle className="h-2.5 w-2.5 fill-destructive" /> : <Pause className="h-3 w-3" />}
      {liveTail ? "实时" : "暂停"}
    </button>
  </div>
);
