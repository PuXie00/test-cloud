import { useMemo } from "react";
import type { PermissionId } from "@shared/auth/permissions";
import { usePermissions } from "@/app/auth/permissions";
import { TabBar } from "@/app/components/ics/tab-bar";
import { BuildDebugMotorList } from "./build-debug/build-debug-motor-list";
import { ConfigWizardPanel } from "./right-sidebar/config-wizard/config-wizard-panel";
import { ProjectStructurePanel } from "./right-sidebar/project-structure-panel";
import { RulesPanel } from "./right-sidebar/rules-panel";

export type RightPanelTab = "structure" | "debug" | "wizard" | "rules";

/** 工程结构和规则跟着搭建页（只读也能看）；调试、配置向导要各自的权限 */
const RIGHT_TABS: { id: RightPanelTab; label: string; permission: PermissionId }[] = [
  { id: "structure", label: "工程结构", permission: "build.view" },
  { id: "debug", label: "调试", permission: "build.debug" },
  { id: "wizard", label: "配置向导", permission: "build.edit" },
  { id: "rules", label: "规则", permission: "build.view" },
];

export const isRightPanelTabAllowed = (
  tab: RightPanelTab,
  can: (permission: PermissionId) => boolean,
): boolean => {
  const entry = RIGHT_TABS.find((item) => item.id === tab);
  return entry ? can(entry.permission) : false;
};

type RightSidebarProps = {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
};

export const RightSidebar = ({ activeTab, onTabChange }: RightSidebarProps) => {
  const { can } = usePermissions();
  const tabs = useMemo(
    () => RIGHT_TABS.filter((tab) => can(tab.permission)).map(({ id, label }) => ({ id, label })),
    [can],
  );
  return (
    <aside className="flex h-full w-[600px] shrink-0 flex-col overflow-hidden rounded-lg bg-card">
      <TabBar tabs={tabs} active={activeTab} onChange={onTabChange} variant="filled" />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "structure" && <ProjectStructurePanel />}
        {activeTab === "debug" && can("build.debug") && <BuildDebugMotorList />}
        {activeTab === "wizard" && can("build.edit") && <ConfigWizardPanel />}
        {activeTab === "rules" && <RulesPanel />}
      </div>
    </aside>
  );
};
