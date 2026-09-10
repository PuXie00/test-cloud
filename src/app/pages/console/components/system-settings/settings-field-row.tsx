import type { ReactNode } from "react";
import { cn } from "@/app/components/ui/utils";

type SettingsFieldRowProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

export const SettingsFieldRow = ({ label, children, className }: SettingsFieldRowProps) => (
  <div className={cn("flex items-center justify-between gap-4 py-2", className)}>
    <span className="shrink-0 text-body-md text-foreground">{label}</span>
    <div className="flex min-w-0 flex-1 items-center justify-end gap-3">{children}</div>
  </div>
);
