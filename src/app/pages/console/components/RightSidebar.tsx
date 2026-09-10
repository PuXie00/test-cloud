import { TabBar } from "@/app/components/ics/tab-bar";
import { BuildDebugMotorList } from "./build-debug/build-debug-motor-list";
import { ConfigWizardPanel } from "./right-sidebar/config-wizard/config-wizard-panel";
import { ProjectStructurePanel } from "./right-sidebar/project-structure-panel";
import { RulesPanel } from "./right-sidebar/rules-panel";

export type RightPanelTab = "structure" | "debug" | "wizard" | "rules";

const RIGHT_TABS = [
  { id: "structure" as const, label: "工程结构" },
  { id: "debug" as const, label: "调试" },
  { id: "wizard" as const, label: "配置向导" },
  { id: "rules" as const, label: "规则" },
];

type RightSidebarProps = {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
};

export const RightSidebar = ({ activeTab, onTabChange }: RightSidebarProps) => {
  return (
    <aside className="flex h-full w-[600px] shrink-0 flex-col overflow-hidden rounded-lg bg-card">
      <TabBar tabs={RIGHT_TABS} active={activeTab} onChange={onTabChange} variant="filled" />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "structure" && <ProjectStructurePanel />}
        {activeTab === "debug" && <BuildDebugMotorList />}
        {activeTab === "wizard" && <ConfigWizardPanel />}
        {activeTab === "rules" && <RulesPanel />}
      </div>
    </aside>
  );
};
