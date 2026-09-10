import { TabBar } from "@/app/components/ics/tab-bar";

export type LicenseDialogTab = "info" | "activate";

const TABS = [
  { id: "info" as const, label: "授权信息" },
  { id: "activate" as const, label: "激活授权" },
];

type LicenseDialogTabsProps = {
  active: LicenseDialogTab;
  onChange: (tab: LicenseDialogTab) => void;
};

export const LicenseDialogTabs = ({ active, onChange }: LicenseDialogTabsProps) => (
  <TabBar tabs={TABS} active={active} onChange={onChange} variant="underline" className="h-10" />
);
