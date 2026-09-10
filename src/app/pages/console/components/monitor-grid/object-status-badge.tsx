import type { ReactNode } from "react";
import { cn } from "@/app/components/ui/utils";
import type { ControlledObjectStatus } from "./monitor-data";
import { MODEL_STATUS, type MotorRuntimeStatus } from "./monitor-status";
import {
  RUNTIME_BADGE_STYLES,
  RUNTIME_DOT_STYLES,
  WARNING_BADGE_STYLE,
  WARNING_DOT_STYLE,
} from "./runtime-status-styles";

export const OBJECT_STATUS_LABEL: Record<ControlledObjectStatus, string> = {
  ready: "就绪",
  running: "运行中",
  warning: "警告",
  alarm: "报警",
  disabled: "未使能",
  offline: "离线",
};

/** 有 modelStatus 时用 MODEL_STATUS 细码文案（未初始化 / 未耦合 / 就绪…） */
export const resolveObjectStatusLabel = (
  status: ControlledObjectStatus,
  modelStatus?: number | null,
): string => {
  if (modelStatus == null) return OBJECT_STATUS_LABEL[status];
  return MODEL_STATUS[modelStatus]?.label ?? OBJECT_STATUS_LABEL[status];
};

const OBJECT_TO_RUNTIME: Record<ControlledObjectStatus, MotorRuntimeStatus | "warning"> = {
  running: "moving",
  ready: "idle",
  alarm: "error",
  disabled: "powerOff",
  offline: "powerOff",
  warning: "warning",
};

export const objectStatusBadgeClass = (status: ControlledObjectStatus): string => {
  const kind = OBJECT_TO_RUNTIME[status];
  return kind === "warning" ? WARNING_BADGE_STYLE : RUNTIME_BADGE_STYLES[kind];
};

export const objectStatusDotClass = (status: ControlledObjectStatus): string => {
  const kind = OBJECT_TO_RUNTIME[status];
  return kind === "warning" ? WARNING_DOT_STYLE : RUNTIME_DOT_STYLES[kind];
};

export const objectStatusCardBorderClass: Record<ControlledObjectStatus, string> = {
  ready: "border-border",
  running: "border-show/40",
  warning: "border-warning/40 bg-warning/5",
  alarm: "border-destructive/60 bg-destructive/5 animate-pulse",
  disabled: "border-border opacity-60",
  offline: "border-border border-dashed opacity-40",
};

type ObjectStatusBadgeProps = {
  status: ControlledObjectStatus;
  modelStatus?: number | null;
  className?: string;
  children?: ReactNode;
};

export const ObjectStatusBadge = ({
  status,
  modelStatus,
  className,
  children,
}: ObjectStatusBadgeProps) => (
  <span
    className={cn(
      "inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
      objectStatusBadgeClass(status),
      className,
    )}
  >
    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", objectStatusDotClass(status))} aria-hidden />
    <span className="truncate">
      {children ?? resolveObjectStatusLabel(status, modelStatus)}
    </span>
  </span>
);
