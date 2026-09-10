import type { LucideIcon } from "lucide-react";
import { cn } from "@/app/components/ui/utils";

type PanelIconButtonProps = {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  className?: string;
};

export const PanelIconButton = ({ icon: Icon, label, onClick, className }: PanelIconButtonProps) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={cn(
      "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
      className,
    )}
  >
    <Icon className="h-3.5 w-3.5" aria-hidden />
  </button>
);
