import { cn } from "@/app/components/ui/utils";
import type { ProjectFilterTab } from "@/app/project/project-types";

const TABS: { id: ProjectFilterTab; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "recent", label: "最近使用" },
  { id: "archived", label: "已归档" },
];

type ProjectFilterTabsProps = {
  active: ProjectFilterTab;
  onChange: (tab: ProjectFilterTab) => void;
};

export const ProjectFilterTabs = ({ active, onChange }: ProjectFilterTabsProps) => (
  <div className="flex gap-2" role="tablist" aria-label="工程筛选">
    {TABS.map((tab) => (
      <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={active === tab.id}
        onClick={() => onChange(tab.id)}
        className={cn(
          "rounded-md border px-4 py-2 text-body-sm transition-colors",
          active === tab.id
            ? "border-primary bg-card text-primary"
            : "border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
        )}
      >
        {tab.label}
      </button>
    ))}
  </div>
);
