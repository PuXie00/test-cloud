import type { ReactNode } from "react";
import { cn } from "@/app/components/ui/utils";

type CollabStatusPillProps = {
  variant: "active" | "idle" | "info";
  children: ReactNode;
  className?: string;
};

const VARIANTS = {
  active: "bg-show/10 text-show [&_span]:bg-show",
  idle: "bg-muted text-muted-foreground [&_span]:bg-muted-foreground",
  info: "bg-secondary/10 text-secondary [&_span]:bg-secondary",
} as const;

export const CollabStatusPill = ({ variant, children, className }: CollabStatusPillProps) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-label-caps",
      VARIANTS[variant],
      className,
    )}
  >
    <span className="h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden />
    {children}
  </span>
);
