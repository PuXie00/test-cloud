import type { ReactNode } from "react";
import { cn } from "@/app/components/ui/utils";

type SettingsSectionProps = {
  title: string;
  children: ReactNode;
  className?: string;
};

export const SettingsSection = ({ title, children, className }: SettingsSectionProps) => (
  <section className={cn("flex flex-col gap-3", className)}>
    <h3 className="text-label-caps text-foreground">{title}</h3>
    {children}
  </section>
);
