import type { MotorRuntimeStatus } from "./monitor-status";

export const RUNTIME_BADGE_STYLES: Record<MotorRuntimeStatus, string> = {
  powerOff: "bg-muted text-muted-foreground",
  error: "bg-destructive/15 text-destructive",
  idle: "bg-secondary/15 text-secondary",
  moving: "bg-show/15 text-show",
};

export const RUNTIME_DOT_STYLES: Record<MotorRuntimeStatus, string> = {
  powerOff: "bg-muted-foreground",
  error: "bg-destructive",
  idle: "bg-secondary",
  moving: "bg-show",
};

export const WARNING_BADGE_STYLE = "bg-warning/15 text-warning";
export const WARNING_DOT_STYLE = "bg-warning";
