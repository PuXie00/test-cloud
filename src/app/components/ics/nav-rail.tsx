import type { ElementType, ReactNode } from "react";
import { cn } from "../ui/utils";

export type NavRailItem<T extends string> = {
  id: T;
  icon: ElementType;
  label: string;
};

type NavRailProps<T extends string> = {
  items: readonly NavRailItem<T>[];
  active: T;
  onChange: (id: T) => void;
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export const NavRail = <T extends string>({ items, active, onChange, header, footer, className }: NavRailProps<T>) => (
  <div className={cn("flex w-16 shrink-0 flex-col bg-background pb-3", className)}>
    {header}
    {items.map((item) => {
      const isActive = active === item.id;
      return (
        <button
          key={item.id}
          type="button"
          aria-label={item.label}
          aria-current={isActive ? "page" : undefined}
          onClick={() => onChange(item.id)}
          className={cn(
            "relative flex w-full flex-col items-center gap-1 py-3 transition-colors",
            isActive ? "text-primary bg-card" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {isActive && <span className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r bg-primary" aria-hidden />}
          <item.icon className="h-6 w-6" />
          <span className=" text-xs font-bold leading-none tracking-wide">{item.label}</span>
        </button>
      );
    })}
    <div className="flex-1" />
    {footer}
  </div>
);
