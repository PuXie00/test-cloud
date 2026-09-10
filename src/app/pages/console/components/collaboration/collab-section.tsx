import type { ReactNode } from "react";
import { cn } from "@/app/components/ui/utils";

type CollabSectionProps = {
  title: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
};

export const CollabSection = ({ title, children, className, action }: CollabSectionProps) => (
  <section className={cn("flex flex-col bg-muted pt-2 rounded-lg overflow-hidden", className)}>
    <div className="flex items-center justify-between gap-2 px-3">
      <h3 className="text-label-caps text-foreground">{title}</h3>
      {action}
    </div>
    {children}
  </section>
);
