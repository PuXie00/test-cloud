"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "lucide-react";
import { cn } from "./utils";

function Checkbox({
  className,
  children,
  id,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  children?: React.ReactNode;
}) {
  const autoId = React.useId();
  const checkboxId = id ?? autoId;

  const box = (
    <CheckboxPrimitive.Root
      id={checkboxId}
      data-slot="checkbox"
      className={cn(
        "peer shrink-0 rounded-[4px] border border-border bg-input-background shadow-xs transition-shadow outline-none",
        "size-4 [@media(pointer:coarse)]:size-5",
        "data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (!children) return box;

  return (
    <label
      htmlFor={checkboxId}
      className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-body-sm text-foreground [@media(pointer:coarse)]:min-h-10"
    >
      {box}
      <span>{children}</span>
    </label>
  );
}

export { Checkbox };
