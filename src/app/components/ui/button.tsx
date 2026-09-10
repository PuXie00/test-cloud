import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-label-caps transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground font-semibold hover:bg-primary/80 active:bg-primary/70",
        destructive:
          "bg-danger text-danger-foreground font-semibold hover:bg-danger/80 active:bg-destructive active:text-destructive-foreground",
        outline:
          "border border-primary bg-transparent text-primary hover:bg-primary/10 active:bg-primary/15",
        secondary:
          "border border-border bg-transparent text-foreground hover:bg-muted/50 active:bg-muted",
        ghost:
          "text-muted-foreground hover:bg-muted/50 hover:text-foreground active:bg-muted",
        link: "text-primary underline-offset-4 hover:underline normal-case tracking-normal font-normal text-body-md",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3",
        lg: "h-10 px-6",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
