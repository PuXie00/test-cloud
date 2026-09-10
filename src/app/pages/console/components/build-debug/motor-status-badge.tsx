import { cn } from "@/app/components/ui/utils";
import { MOTOR_STATUS_LABEL, type MotorRuntimeStatus } from "./build-debug-types";
import { RUNTIME_BADGE_STYLES, RUNTIME_DOT_STYLES } from "../monitor-grid/runtime-status-styles";

export type MotorStatusBadgeKind =
  | { type: "coupled" }
  | { type: "runtime"; status: MotorRuntimeStatus };

export const resolveMotorStatusBadge = (params: {
  online: boolean;
  blockedByCouple: boolean;
  status: MotorRuntimeStatus;
}): MotorStatusBadgeKind => {
  if (params.blockedByCouple) return { type: "coupled" };
  if (!params.online) return { type: "runtime", status: "powerOff" };
  return { type: "runtime", status: params.status };
};

export const motorStatusDotClass = (status: MotorRuntimeStatus): string => RUNTIME_DOT_STYLES[status];

type MotorStatusBadgeProps = {
  kind: MotorStatusBadgeKind;
  className?: string;
};

export const MotorStatusBadge = ({ kind, className }: MotorStatusBadgeProps) => {
  const badgeClass =
    kind.type === "runtime" ? RUNTIME_BADGE_STYLES[kind.status] : "bg-secondary/15 text-secondary";
  const dotClass = kind.type === "runtime" ? RUNTIME_DOT_STYLES[kind.status] : "bg-secondary";
  const label = kind.type === "runtime" ? MOTOR_STATUS_LABEL[kind.status] : "耦合";

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
        badgeClass,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
};
