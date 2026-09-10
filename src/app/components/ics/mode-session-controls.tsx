import { Bug, Play, RotateCcw, Square } from "lucide-react";
import type { ConsoleMode } from "./mode-tabs";
import type { SessionVisibility } from "../../hooks/use-mode-session";
import { cn } from "../ui/utils";

type ModeSessionControlsProps = {
  visibility: SessionVisibility;
  mode: ConsoleMode;
  canRestore: boolean;
  canReload: boolean;
  canStop: boolean;
  onStart: (mode: ConsoleMode) => void;
  onRestore: () => void;
  onReload: () => void;
  onStop: () => void;
  showReload?: boolean;
  stopLabel?: string;
  className?: string;
};

const MODE_LABEL: Record<ConsoleMode, string> = {
  show: "演出模式",
  debug: "调试模式",
};

const ghostBtn =
  "inline-flex h-10 items-center gap-2 rounded-md  bg-transparent px-3 text-body-sm transition-colors hover:bg-muted";

const solidBtn = "inline-flex h-10 items-center gap-2 rounded-md px-3 text-body-sm font-medium transition-colors";

export const ModeSessionControls = ({
  visibility,
  mode,
  canRestore,
  canReload,
  canStop,
  onStart,
  onRestore,
  onReload,
  onStop,
  showReload = true,
  stopLabel = "停止",
  className,
}: ModeSessionControlsProps) => {
  if (visibility === "idle") {
    return (
      <div className={cn("flex items-center gap-2", className)} role="toolbar" aria-label="启动模式">
        <button
          type="button"
          aria-label="调试模式"
          onClick={() => onStart("debug")}
          className={cn(ghostBtn, "text-warning")}
        >
          <Bug className="h-4 w-4 shrink-0" aria-hidden />
          <span>{MODE_LABEL.debug}</span>
        </button>
        <button
          type="button"
          aria-label="演出模式"
          onClick={() => onStart("show")}
          className={cn(ghostBtn, "text-show")}
        >
          <Play className="h-4 w-4 shrink-0" aria-hidden />
          <span>{MODE_LABEL.show}</span>
        </button>
      
      </div>
    );
  }

  const ModeIcon = mode === "debug" ? Bug : Play;
  const modeColor = mode === "debug" ? "text-warning" : "text-show";

  return (
    <div className={cn("flex items-center gap-2", className)} role="toolbar" aria-label="模式会话控制">
      <button
        type="button"
        aria-label={canRestore ? "重新打开" : MODE_LABEL[mode]}
        disabled={!canRestore}
        onClick={onRestore}
        className={cn(
          ghostBtn,
          modeColor,
          canRestore ? "hover:bg-muted" : "cursor-default opacity-60"
        )}
      >
        <ModeIcon className="h-4 w-4 shrink-0" aria-hidden />
        <span>{canRestore ? "重新打开" : MODE_LABEL[mode]}</span>
      </button>
      {showReload && (
        <button
          type="button"
          aria-label="重载"
          disabled={!canReload}
          onClick={onReload}
          className={cn(
            solidBtn,
            canReload
              ? "bg-show text-background hover:bg-show/90"
              : "cursor-not-allowed bg-muted text-muted-foreground/40"
          )}
        >
          <RotateCcw className="h-4 w-4 shrink-0" aria-hidden />
          <span>重载</span>
        </button>
      )}
      <button
        type="button"
        aria-label="停止"
        disabled={!canStop}
        onClick={onStop}
        className={cn(
          solidBtn,
          canStop
            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            : "cursor-not-allowed bg-muted text-muted-foreground/40"
        )}
      >
        <Square className="h-3.5 w-3.5 shrink-0 fill-current" aria-hidden />
        <span>{stopLabel}</span>
      </button>
    </div>
  );
};
