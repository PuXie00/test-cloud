import type { ReactNode } from "react";
import { cn } from "@/app/components/ui/utils";

type PermissionsSectionProps = {
  title: string;
  children: ReactNode;
  className?: string;
};

export const PermissionsSection = ({
  title,
  children,
  className,
}: PermissionsSectionProps) => (
  <section className={cn("flex flex-col gap-3", className)}>
    <h3 className="text-label-caps text-foreground">{title}</h3>
    {children}
  </section>
);
