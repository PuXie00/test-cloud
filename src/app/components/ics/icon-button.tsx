import type { ButtonHTMLAttributes, ElementType } from "react";
import { cn } from "../ui/utils";

type IconButtonProps = {
  icon: ElementType;
  active?: boolean;
  className?: string;
  label?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export const IconButton = ({ icon: Icon, active, className, label, ...props }: IconButtonProps) => (
  <button
    type="button"
    aria-label={label}
    className={cn(
      "inline-flex h-8 w-8 items-center justify-center rounded-sm border transition-all",
      active
        ? "border-primary bg-primary text-primary-foreground shadow-[0_0_10px_color-mix(in_srgb,var(--primary)_40%,transparent)]"
        : "border-border bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground",
      className
    )}
    {...props}
  >
    <Icon className="h-4 w-4" />
  </button>
);
