import { GripVertical } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import type { ChapterItem } from "./program-data";

type ChapterItemRowProps = {
  item: ChapterItem;
  slotLabel: string;
  isActive?: boolean;
  isCurrentlyRunning?: boolean;
  hasWarning?: boolean;
  warningMessage?: string;
  draggable?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onDragStart?: (event: React.DragEvent) => void;
};

const formatDurationSeconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export const ChapterItemRow = ({
  item,
  slotLabel,
  isActive,
  isCurrentlyRunning,
  hasWarning,
  warningMessage,
  draggable = true,
  onClick,
  onDoubleClick,
  onDragStart,
}: ChapterItemRowProps) => {
  const name = item.sequence.name;
  const note = item.sequence.note;
  const durationMs = item.sequence.durationMs;
  const accessibleWarning = warningMessage ?? (hasWarning ? "待修复" : undefined);

  const statusDotClass = isCurrentlyRunning
    ? "bg-primary"
    : hasWarning
      ? "bg-warning"
      : "bg-show";

  return (
    <div
      role="treeitem"
      aria-selected={isActive}
      aria-label={accessibleWarning ? `${name}，${accessibleWarning}` : name}
      title={accessibleWarning}
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "group flex h-10 cursor-pointer items-center gap-1 border-l-2 px-2 transition-colors",
        isActive
          ? "border-l-primary bg-muted"
          : "border-l-transparent hover:bg-muted/30"
      )}
    >
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", statusDotClass)}
        aria-label={accessibleWarning}
        title={accessibleWarning}
      />
      <span className="w-10 shrink-0 font-mono text-label-caps text-muted-foreground">
        {slotLabel}
      </span>
      <span className="shrink-0 text-muted-foreground" aria-hidden>
        { "║" }
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="min-w-0 truncate text-body-md text-foreground">{name}</span>
        {note && (
          <span className="min-w-0 truncate text-body-sm text-muted-foreground">{note}</span>
        )}
      </div>
      <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
        {formatDurationSeconds(durationMs)}
      </span>
      {draggable && (
        <GripVertical
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      )}
    </div>
  );
};
