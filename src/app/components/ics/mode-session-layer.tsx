import { Minimize2, X } from "lucide-react";
import type { ComponentType } from "react";
import type { ModeSessionState } from "../../hooks/use-mode-session";
import { cn } from "../ui/utils";

type ModeSessionLayerProps = {
  session: ModeSessionState;
  onHide: () => void;
  onClose: () => void;
  DebugPage: ComponentType<{ reloadKey: number }>;
  ShowPage: ComponentType<{ reloadKey: number }>;
};

const MODE_TITLE = {
  debug: "调试控制台",
  show: "演出控制台",
} as const;

export const ModeSessionLayer = ({
  session,
  onHide,
  onClose,
  DebugPage,
  ShowPage,
}: ModeSessionLayerProps) => {
  if (session.visibility === "idle") return null;

  const Page = session.mode === "debug" ? DebugPage : ShowPage;
  const accentClass = session.mode === "debug" ? "text-warning" : "text-show";

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex flex-col bg-background",
        session.visibility === "hidden" && "pointer-events-none invisible"
      )}
      aria-hidden={session.visibility === "hidden"}
      role="dialog"
      aria-label={MODE_TITLE[session.mode]}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-muted px-4">
        <div className="flex items-center gap-3">
          <span className={cn("text-label-caps", accentClass)}>{MODE_TITLE[session.mode]}</span>
          <span className="text-body-sm text-muted-foreground">
            {session.mode === "debug" ? "解耦 · 单轴调试" : "演出模式 · 配置已锁定"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="隐藏"
            onClick={onHide}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-body-sm hover:bg-accent"
          >
            <Minimize2 className="h-4 w-4" aria-hidden />
            隐藏
          </button>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-body-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
            关闭
          </button>
        </div>
      </header>
      <Page reloadKey={session.reloadKey} />
    </div>
  );
};
