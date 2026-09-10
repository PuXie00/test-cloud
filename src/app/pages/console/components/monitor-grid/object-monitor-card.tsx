import type { KeyboardEvent, MouseEvent } from "react";
import { Bell } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import type { ControlledObjectSnapshot } from "./monitor-data";
import { formatHpyLine } from "./monitor-format";
import {
  ObjectStatusBadge,
  objectStatusCardBorderClass,
  objectStatusDotClass,
} from "./object-status-badge";

export const MONITOR_CARD_SIZE = 120;

type ObjectMonitorCardProps = {
  snapshot: ControlledObjectSnapshot;
  isSelected: boolean;
  onSelect: (event: MouseEvent | KeyboardEvent) => void;
  onDoubleClick?: () => void;
  onAlarmClick?: () => void;
};

export const ObjectMonitorCard = ({
  snapshot,
  isSelected,
  onSelect,
  onDoubleClick,
  onAlarmClick,
}: ObjectMonitorCardProps) => {
  const displayUnit = useSessionDisplayLengthUnit();
  const { descriptor, positions } = snapshot;
  const hasAlarm = descriptor.status === "alarm" || descriptor.status === "warning";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => onSelect(event)}
      onDoubleClick={onDoubleClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(event);
        }
      }}
      style={{ width: MONITOR_CARD_SIZE, height: MONITOR_CARD_SIZE }}
      className={cn(
        "flex shrink-0 flex-col gap-1 rounded-md border bg-card p-2 transition-colors",
        objectStatusCardBorderClass[descriptor.status],
        isSelected && "ring-1 ring-primary",
      )}
    >
      <div className="flex min-h-0 items-start gap-1.5">
        <span
          className={cn(
            "mt-1 h-2 w-2 shrink-0 rounded-full",
            objectStatusDotClass(descriptor.status),
          )}
        />
        <span className="min-w-0 flex-1 truncate text-body-sm font-semibold leading-tight text-foreground">
          {descriptor.name}
        </span>
        {hasAlarm && (
          <button
            type="button"
            aria-label="查看报警"
            onClick={(event) => {
              event.stopPropagation();
              onAlarmClick?.();
            }}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-warning hover:bg-accent"
          >
            <Bell className="h-3 w-3" />
          </button>
        )}
      </div>

      <ObjectStatusBadge
        status={descriptor.status}
        modelStatus={snapshot.modelStatus}
        className="w-fit"
      />

      <span className="mt-auto font-mono text-mono-sm tabular-nums text-muted-foreground">
        {formatHpyLine(positions, displayUnit, descriptor.dimensions[0]?.unit ?? "mm")}
      </span>
    </div>
  );
};
