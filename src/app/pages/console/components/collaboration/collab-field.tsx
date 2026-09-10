import type { ReactNode } from "react";
import { cn } from "@/app/components/ui/utils";

type CollabFieldProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

export const CollabField = ({ label, children, className }: CollabFieldProps) => (
  <div className={cn("flex flex-col gap-2", className)}>
    <span className="text-body-sm text-muted-foreground">{label}</span>
    {children}
  </div>
);
