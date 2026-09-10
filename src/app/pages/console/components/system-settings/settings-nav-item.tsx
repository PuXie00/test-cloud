import type { LucideIcon } from "lucide-react";
import { cn } from "@/app/components/ui/utils";

type SettingsNavItemProps = {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
};

export const SettingsNavItem = ({ label, icon: Icon, active, onClick }: SettingsNavItemProps) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "flex h-10 w-full items-center gap-3 rounded-sm px-3 text-left text-body-md transition-colors",
      active
        ? "border-l-2 border-primary bg-muted text-primary"
        : "border-l-2 border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
    )}
  >
    <Icon className="h-4 w-4 shrink-0" aria-hidden />
    <span>{label}</span>
  </button>
);
