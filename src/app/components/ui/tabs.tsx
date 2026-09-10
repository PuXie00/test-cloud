"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "./utils";

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col", className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  variant = "underline",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  variant?: "underline" | "filled";
}) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 w-full items-stretch border-b border-border",
        variant === "filled" ? "bg-muted/30" : "bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  variant = "underline",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & {
  variant?: "underline" | "filled";
}) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex flex-1 items-center justify-center whitespace-nowrap transition-colors outline-none disabled:pointer-events-none disabled:opacity-50",
        variant === "filled"
          ? "border-r border-border px-5 text-label-caps text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:text-foreground"
          : "px-3 text-body-sm text-muted-foreground data-[state=active]:text-primary hover:text-foreground data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-primary",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
