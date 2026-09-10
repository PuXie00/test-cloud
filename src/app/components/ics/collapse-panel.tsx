"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/app/components/ui/collapsible";
import { cn } from "@/app/components/ui/utils";

type CollapsePanelProps = {
  title: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children?: ReactNode;
};

export const CollapsePanel = ({
  title,
  defaultOpen = true,
  open,
  onOpenChange,
  className,
  children,
}: CollapsePanelProps) => (
  <Collapsible
    defaultOpen={open === undefined ? defaultOpen : undefined}
    open={open}
    onOpenChange={onOpenChange}
    className={cn("min-w-0 overflow-hidden rounded-md bg-muted", className)}
  >
    <CollapsibleTrigger
      className="group flex h-9 w-full items-center gap-2 px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={title}
    >
      <ChevronRight
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
        aria-hidden
      />
      <span className="truncate text-label-caps text-foreground">{title}</span>
    </CollapsibleTrigger>
    <CollapsibleContent className="min-w-0 overflow-hidden rounded-b-md bg-background p-3 data-[state=closed]:hidden">
      {children}
    </CollapsibleContent>
  </Collapsible>
);
