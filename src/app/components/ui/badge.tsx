import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border-2 px-2 py-0.5 text-label-caps whitespace-nowrap shrink-0 transition-colors",
  {
    variants: {
      variant: {
        default: "border-primary/50 text-primary",
        online: "border-primary/50 text-primary",
        warning: "border-warning/50 text-warning",
        error: "border-destructive/50 text-destructive",
        offline: "border-muted-foreground/50 text-muted-foreground",
        info: "border-info/50 text-info",
        secondary: "border-secondary/50 text-secondary",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const dotVariants: Record<string, string> = {
  default: "bg-primary",
  online: "bg-primary",
  warning: "bg-warning",
  error: "bg-destructive",
  offline: "bg-muted-foreground",
  info: "bg-info",
  secondary: "bg-secondary",
  outline: "bg-muted-foreground",
};

function Badge({
  className,
  variant = "default",
  dot = true,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean;
    dot?: boolean;
  }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && variant && (
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotVariants[variant ?? "default"])} />
      )}
      {children}
    </Comp>
  );
}

export { Badge, badgeVariants };
