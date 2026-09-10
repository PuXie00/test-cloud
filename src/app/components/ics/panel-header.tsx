import type { ElementType, ReactNode } from "react";
import { cn } from "../ui/utils";

type PanelHeaderProps = {
  title: string;
  icon?: ElementType;
  extra?: ReactNode;
  className?: string;
};

export const PanelHeader = ({ title, icon: Icon, extra, className }: PanelHeaderProps) => (
  <div className={cn("flex h-9 shrink-0 items-center justify-between bg-muted px-3", className)}>
    <div className="flex min-w-0 items-center gap-2">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      <span className="truncate text-label-caps text-foreground">{title}</span>
    </div>
    {extra && <div className="flex shrink-0 items-center gap-2">{extra}</div>}
  </div>
);
