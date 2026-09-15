import { cn } from "../ui/utils";

type TabItem<T extends string> = {
  id: T;
  label: string;
};

type TabBarProps<T extends string> = {
  tabs: readonly TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  variant?: "underline" | "filled";
  className?: string;
};

export const TabBar = <T extends string>({
  tabs,
  active,
  onChange,
  variant = "underline",
  className,
}: TabBarProps<T>) => (
  <div
    className={cn(
      "flex shrink-0",
      variant === "filled" ? "h-9 bg-muted/30 [@media(pointer:coarse)]:h-11" : "h-9 bg-transparent border-b border-border [@media(pointer:coarse)]:h-11",
      className
    )}
    role="tablist"
  >
    {tabs.map((tab) => {
      const isActive = active === tab.id;
      return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={isActive}
          onClick={() => onChange(tab.id)}
          className={cn(
            "relative transition-colors",
            variant === "filled"
              ? cn(
                  "h-full min-w-0 flex-1 truncate px-1.5 text-center text-label-caps bg-muted",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )
              : cn(
                  "flex-1 px-3 text-body-sm",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
                ),
          )}
        >
          {tab.label}
          {variant === "underline" && isActive && (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" aria-hidden />
          )}
        </button>
      );
    })}
  </div>
);
