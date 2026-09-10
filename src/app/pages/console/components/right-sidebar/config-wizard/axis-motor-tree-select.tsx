import { ChevronDown, ChevronRight, Link2, Link2Off } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/app/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/components/ui/tooltip";
import { cn } from "@/app/components/ui/utils";
import type { AxisBindingRef } from "@/app/pages/console/hooks/binding-utils";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import {
  buildAxisMotorTree,
  getDefaultExpandedPlcIds,
  MOTOR_BIND_DISABLED_LABELS,
} from "./axis-motor-tree";
import type { Motor, Plc } from "./config-wizard-types";

export type AxisMotorTreeSelectProps = {
  objectId: number;
  axisKey: string;
  value: number | null;
  plcs: readonly Plc[];
  motors: readonly Motor[];
  effectiveBindings: readonly AxisBindingRef[];
  pendingUnbind?: boolean;
  pendingBind?: boolean;
  "aria-label"?: string;
  onChange: (motorId: number | null) => void;
};

export const AxisMotorTreeSelect = ({
  objectId,
  axisKey,
  value,
  plcs,
  motors,
  effectiveBindings,
  pendingUnbind = false,
  pendingBind = false,
  "aria-label": ariaLabel,
  onChange,
}: AxisMotorTreeSelectProps) => {
  const [open, setOpen] = useState(false);
  const tree = useMemo(
    () =>
      buildAxisMotorTree({
        objectId,
        axisKey,
        value,
        plcs,
        motors,
        effectiveBindings,
      }),
    [objectId, axisKey, value, plcs, motors, effectiveBindings],
  );
  const [expandedPlcIds, setExpandedPlcIds] = useState<number[] | null>(null);
  const resolvedExpanded = expandedPlcIds ?? getDefaultExpandedPlcIds(tree, value);
  const boundMotor = value != null ? motors.find((motor) => motor.id === value) : null;
  const canUnbind = value !== null || pendingBind;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setExpandedPlcIds(getDefaultExpandedPlcIds(tree, value));
    }
  };

  const handleTogglePlc = (plcId: number) => {
    setExpandedPlcIds((previous) => {
      const current = previous ?? getDefaultExpandedPlcIds(tree, value);
      return current.includes(plcId)
        ? current.filter((id) => id !== plcId)
        : [...current, plcId];
    });
  };

  const handleSelectMotor = (motorId: number) => {
    onChange(motorId);
    setOpen(false);
  };

  const handleUnbind = () => {
    if (!canUnbind) return;
    onChange(null);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel ?? "选择驱动电机"}
          className={cn(
            "inline-flex min-h-7 min-w-0 flex-1 items-center gap-1 rounded-sm px-1.5 text-left text-[10px]",
            "hover:bg-accent",
          )}
        >
          {pendingUnbind ? (
            <span className="min-w-0 truncate text-warning">应用后解绑</span>
          ) : boundMotor ? (
            <span
              className={cn(
                "inline-flex min-w-0 items-center gap-1 truncate",
                pendingBind ? "text-warning" : "text-show",
              )}
            >
              <Link2 className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">
                {formatMotorDisplayName(motors, boundMotor)}
                {pendingBind ? " · 应用后绑定" : ""}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground w-full text-right">未绑定</span>
          )}
          <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 border-0 bg-card p-0 text-foreground shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
      >
        <div className="max-h-72 overflow-y-auto p-1">
          <button
            type="button"
            disabled={!canUnbind}
            onClick={handleUnbind}
            className={cn(
              "flex h-9 w-full items-center gap-2 rounded-sm px-2 text-body-sm",
              canUnbind
                ? "text-muted-foreground hover:bg-accent hover:text-warning"
                : "cursor-not-allowed text-muted-foreground opacity-40",
            )}
          >
            <Link2Off className="h-3.5 w-3.5" aria-hidden />
            解绑
          </button>

          {tree.map((plcNode) => {
            const expanded = resolvedExpanded.includes(plcNode.plc.id);
            return (
              <div key={plcNode.plc.id}>
                <button
                  type="button"
                  onClick={() => handleTogglePlc(plcNode.plc.id)}
                  className="flex h-9 w-full items-center gap-1 rounded-sm px-2 text-body-sm text-foreground hover:bg-accent"
                >
                  {expanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left">{plcNode.label}</span>
                  {plcNode.incompatible ? (
                    <span className="shrink-0 text-mono-sm text-muted-foreground">不兼容</span>
                  ) : null}
                </button>
                {expanded
                  ? plcNode.buses.map((busNode) => (
                      <div key={`${plcNode.plc.id}-${busNode.busNo}`}>
                        <div
                          className="flex h-7 items-center px-2 pl-5 text-label-caps text-muted-foreground"
                          aria-hidden
                        >
                          {busNode.label}
                        </div>
                        {busNode.motors.map((motorNode) => {
                          const row = (
                            <button
                              key={motorNode.motor.id}
                              type="button"
                              disabled={motorNode.disabled}
                              onClick={() => handleSelectMotor(motorNode.motor.id)}
                              className={cn(
                                "flex h-9 w-full items-center rounded-sm py-0 pl-8 pr-2 text-left text-body-sm",
                                motorNode.selected &&
                                  "border-l-2 border-primary bg-accent text-foreground",
                                !motorNode.selected &&
                                  !motorNode.disabled &&
                                  "text-foreground hover:bg-accent",
                                motorNode.disabled &&
                                  "cursor-not-allowed text-muted-foreground opacity-40",
                              )}
                            >
                              <span className="truncate">{motorNode.label}</span>
                            </button>
                          );
                          if (!motorNode.disabled || !motorNode.disabledReason) return row;
                          return (
                            <Tooltip key={motorNode.motor.id}>
                              <TooltipTrigger asChild>{row}</TooltipTrigger>
                              <TooltipContent>
                                {MOTOR_BIND_DISABLED_LABELS[motorNode.disabledReason]}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    ))
                  : null}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};
