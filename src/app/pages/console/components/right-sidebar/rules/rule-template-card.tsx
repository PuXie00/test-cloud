import type { ElementType } from "react";
import { cn } from "@/app/components/ui/utils";

type RuleTemplateCardProps = {
  name: string;
  description: string;
  icon: ElementType;
  onClick: () => void;
  variant?: "template" | "blank";
  layout?: "horizontal" | "grid";
  selected?: boolean;
};

export const RuleTemplateCard = ({
  name,
  description,
  icon: Icon,
  onClick,
  variant = "template",
  layout = "horizontal",
  selected = false,
}: RuleTemplateCardProps) => {
  if (layout === "grid") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          "flex flex-col items-start gap-2 rounded-md border bg-background p-3 text-left transition-colors",
          "[@media(pointer:coarse)]:p-4",
          selected
            ? "border-primary bg-primary/10 ring-1 ring-primary/40"
            : variant === "template"
              ? "border-border hover:border-primary/60 hover:bg-accent/40"
              : "border-dashed border-border text-muted-foreground hover:border-primary/60 hover:text-foreground"
        )}
      >
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            variant === "template" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 w-full">
          <p className="text-body-md text-foreground">{name}</p>
          <p className="mt-0.5 line-clamp-2 text-body-sm text-muted-foreground">{description}</p>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "group flex h-14 min-w-[200px] shrink-0 items-center gap-3 rounded-md border bg-background px-3 text-left transition-colors",
        "[@media(pointer:coarse)]:h-16 [@media(pointer:coarse)]:min-w-[220px]",
        selected
          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
          : variant === "template"
            ? "border-border hover:border-primary/60 hover:bg-accent/40"
            : "border-dashed border-border text-muted-foreground hover:border-primary/60 hover:text-foreground"
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
          variant === "template" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-md text-foreground">{name}</p>
        <p className="truncate text-body-sm text-muted-foreground">{description}</p>
      </div>
    </button>
  );
};
