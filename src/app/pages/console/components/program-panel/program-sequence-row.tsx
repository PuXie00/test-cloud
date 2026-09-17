import { Play, X } from "lucide-react";
import type { DragEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import { ForcedTrajectoryBadge } from "../forced-trajectory-badge";

export type ProgramSequenceRowProps = {
  name: string;
  indexLabel: string;
  durationLabel?: string | null;
  repairMessage?: string | null;
  forced?: boolean;
  draggable?: boolean;
  dropActive?: boolean;
  striped?: boolean;
  role?: "treeitem";
  ariaSelected?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onDragOver?: (event: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (event: DragEvent) => void;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onLaunch?: () => void;
  onRemove?: () => void;
  launchDisabled?: boolean;
};

export const ProgramSequenceRow = ({
  name,
  indexLabel,
  durationLabel,
  repairMessage,
  forced = false,
  draggable = false,
  dropActive = false,
  striped = false,
  role,
  ariaSelected,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
  onDoubleClick,
  onLaunch,
  onRemove,
  launchDisabled,
}: ProgramSequenceRowProps) => {
  const warning = repairMessage ?? undefined;
  const accessibleLabel = [name, forced ? "强制轨迹" : null, warning].filter(Boolean).join("，");

  return (
    <div
      role={role}
      aria-selected={role === "treeitem" ? Boolean(ariaSelected) : undefined}
      aria-label={accessibleLabel}
      title={warning}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "group mx-1 flex min-h-[40px] items-center gap-2 rounded-sm border-t-2 px-2 transition-colors",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        dropActive ? "border-t-primary" : "border-t-transparent",
        striped ? "bg-accent/40" : "bg-input-background",
        "hover:bg-accent",
      )}
    >
      <span className="w-8 shrink-0 text-right font-mono text-mono-sm tabular-nums text-muted-foreground">
        {indexLabel}
      </span>
      <span className="min-w-0 flex-1 truncate text-body-sm text-foreground">{name}</span>
      {forced ? <ForcedTrajectoryBadge /> : null}
      {warning ? (
        <span className="shrink-0 text-body-sm text-warning">待修复</span>
      ) : null}
      {durationLabel ? (
        <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
          {durationLabel}
        </span>
      ) : null}
      {onLaunch ? (
        <button
          type="button"
          aria-label={`运行 ${name}`}
          disabled={launchDisabled}
          onClick={(event) => {
            event.stopPropagation();
            onLaunch();
          }}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-primary/15 hover:text-primary disabled:opacity-40"
        >
          <Play className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          aria-label={`移除 ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
};
