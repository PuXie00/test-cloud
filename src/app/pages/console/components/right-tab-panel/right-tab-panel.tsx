import { useMemo, useState } from "react";
import { cn } from "@/app/components/ui/utils";
import { TabBar } from "@/app/components/ics/tab-bar";
import { useConsoleMode } from "../../hooks/use-console-mode";
import { useLogStream } from "../../hooks/use-log-stream";
import { ManualControlTab } from "./manual-control-tab/manual-control-tab";
import { LogTab } from "./log-tab/log-tab";
import { DetailTab } from "./detail-tab/detail-tab";

type RightTabId = "manual" | "log" | "detail";

const TAB_LABEL: Record<RightTabId, string> = {
  manual: "手动控制",
  log: "日志",
  detail: "物体详情",
};

type RightTabPanelProps = { className?: string };

export const RightTabPanel = ({ className }: RightTabPanelProps) => {
  const { mode } = useConsoleMode();
  const { unreadCount } = useLogStream();
  const [active, setActive] = useState<RightTabId>("log");

  const tabs = useMemo(() => {
    const list: { id: RightTabId; label: string }[] =
      mode === "show"
        ? [
            { id: "log", label: TAB_LABEL.log + (unreadCount > 0 ? ` (${unreadCount})` : "") },
            { id: "detail", label: TAB_LABEL.detail },
          ]
        : [
            { id: "manual", label: TAB_LABEL.manual },
            { id: "log", label: TAB_LABEL.log + (unreadCount > 0 ? ` (${unreadCount})` : "") },
            { id: "detail", label: TAB_LABEL.detail },
          ];
    return list;
  }, [mode, unreadCount]);

  const safeActive = mode === "show" && active === "manual" ? "log" : active;

  return (
    <aside className={cn("flex shrink-0 flex-col bg-card overflow-hidden rounded-lg", className)}>
      <TabBar tabs={tabs} active={safeActive} onChange={setActive} variant="filled" />
      <div className="min-h-0 flex-1">
        {safeActive === "manual" && <ManualControlTab />}
        {safeActive === "log" && <LogTab />}
        {safeActive === "detail" && <DetailTab />}
      </div>
    </aside>
  );
};
