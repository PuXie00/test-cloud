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
        // 不用原生 button：切页签只是看，在只读范围（fieldset disabled）里也要能切
        <div
          key={tab.id}
          role="tab"
          tabIndex={0}
          aria-selected={isActive}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onChange(tab.id);
          }}
          className={cn(
            "relative flex cursor-pointer select-none items-center justify-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            variant === "filled"
              ? cn(
                  "h-full min-w-0 flex-1 px-1.5 text-center text-label-caps bg-muted",
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
          <span className="min-w-0 truncate">{tab.label}</span>
          {variant === "underline" && isActive && (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" aria-hidden />
          )}
        </div>
      );
    })}
  </div>
);
