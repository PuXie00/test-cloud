import type { ReactNode } from "react";
import { cn } from "../ui/utils";

const STATUS_STYLES = {
  online: "bg-primary/10 text-primary",
  warning: "bg-warning/10 text-warning",
  error: "bg-destructive/10 text-destructive",
  offline: "bg-muted text-muted-foreground",
  info: "bg-info/10 text-info",
} as const;

const DOT_STYLES = {
  online: "bg-primary",
  warning: "bg-warning",
  error: "bg-destructive",
  offline: "bg-muted-foreground",
  info: "bg-info",
} as const;

export type StatusBadgeVariant = keyof typeof STATUS_STYLES;

type StatusBadgeProps = {
  variant: StatusBadgeVariant;
  children: ReactNode;
  className?: string;
};

export const StatusBadge = ({ variant, children, className }: StatusBadgeProps) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-label-caps",
      STATUS_STYLES[variant],
      className
    )}
  >
    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_STYLES[variant])} />
    {children}
  </span>
);
