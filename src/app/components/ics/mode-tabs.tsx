import { cn } from "../ui/utils";

export type ConsoleMode = "debug" | "show";

const MODE_TABS: { id: ConsoleMode; label: string }[] = [
  { id: "debug", label: "调试模式" },
  { id: "show", label: "演出模式" },
];

const MODE_COLOR: Record<ConsoleMode, { text: string; bar: string }> = {
  debug: { text: "text-warning", bar: "bg-warning" },
  show: { text: "text-show", bar: "bg-show" },
};

type ModeTabsProps = {
  value: ConsoleMode;
  onChange: (mode: ConsoleMode) => void;
  disabled?: boolean;
  className?: string;
};

export const ModeTabs = ({ value, onChange, disabled, className }: ModeTabsProps) => (
  <div className={cn("flex items-center gap-8", className)} role="tablist" aria-label="Operation mode">
    {MODE_TABS.map((tab) => {
      const active = value === tab.id;
      const colors = MODE_COLOR[tab.id];
      return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active}
          disabled={disabled}
          onClick={() => onChange(tab.id)}
          className={cn(
            "relative pb-1 text-body-md transition-colors",
            disabled && "cursor-not-allowed opacity-50",
            active ? colors.text : "text-muted-foreground hover:text-foreground"
          )}
        >
          [{tab.label}]
          {active && <span className={cn("absolute inset-x-0 -bottom-px h-0.5", colors.bar)} aria-hidden />}
        </button>
      );
    })}
  </div>
);
