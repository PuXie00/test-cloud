import { useMemo } from "react";
import { cn } from "@/app/components/ui/utils";
import { TabBar } from "@/app/components/ics/tab-bar";
import { useConsoleMode } from "../../hooks/use-console-mode";
import {
  useControlLayout,
  type ControlRightTabId,
} from "../../hooks/use-control-layout";
import { ProgramPanel } from "../program-panel/program-panel";
import { ManualControlTab } from "./manual-control-tab/manual-control-tab";
import { LogTab } from "./log-tab/log-tab";
import { DetailTab } from "./detail-tab/detail-tab";

const TAB_LABEL: Record<ControlRightTabId, string> = {
  manual: "手动控制",
  program: "节目",
  log: "日志",
  detail: "详情",
};

type RightTabPanelProps = { className?: string };

export const RightTabPanel = ({ className }: RightTabPanelProps) => {
  const { mode } = useConsoleMode();
  const { activeRightTab, setActiveRightTab } = useControlLayout();

  const tabs = useMemo(() => {
    const rehearsal: { id: ControlRightTabId; label: string }[] = [
      { id: "manual", label: TAB_LABEL.manual },
      { id: "program", label: TAB_LABEL.program },
      { id: "log", label: TAB_LABEL.log },
      { id: "detail", label: TAB_LABEL.detail },
    ];
    if (mode === "show") {
      return rehearsal.filter((tab) => tab.id !== "manual");
    }
    return rehearsal;
  }, [mode]);

  const safeActive: ControlRightTabId =
    mode === "show" && activeRightTab === "manual" ? "log" : activeRightTab;

  return (
    <aside className={cn("flex shrink-0 flex-col overflow-hidden rounded-lg bg-card", className)}>
      <TabBar
        tabs={tabs}
        active={safeActive}
        onChange={setActiveRightTab}
        variant="filled"
        className="min-w-0"
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {safeActive === "manual" && <ManualControlTab />}
        {safeActive === "program" && <ProgramPanel variant="control" />}
        {safeActive === "log" && <LogTab />}
        {safeActive === "detail" && <DetailTab />}
      </div>
    </aside>
  );
};
