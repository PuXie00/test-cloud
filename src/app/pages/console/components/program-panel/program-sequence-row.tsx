import { GripVertical, X } from "lucide-react";
import { useEffect, useRef, type DragEvent, type PointerEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import { ForcedTrajectoryBadge } from "../forced-trajectory-badge";
import { LoopBadge } from "../loop-badge";
import {
  NEAREST_LABEL,
  NearestBadge,
  REVERSE_LABEL,
  ReverseBadge,
  SAFE_GROUP_LABEL,
  SafeGroupBadge,
} from "../run-option-badges";

const LONG_PRESS_MS = 400;
const LONG_PRESS_MOVE_PX = 8;

export type ProgramSequenceRowProps = {
  name: string;
  indexLabel?: string;
  durationLabel?: string | null;
  repairMessage?: string | null;
  forced?: boolean;
  loop?: boolean;
  /** 推子槽运行选项（存于节目条目） */
  safeGroup?: boolean;
  nearest?: boolean;
  reverse?: boolean;
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
  onPreviewHoldStart?: () => void;
  onPreviewHoldEnd?: () => void;
  onRemove?: () => void;
};

export const ProgramSequenceRow = ({
  name,
  indexLabel,
  durationLabel,
  repairMessage,
  forced = false,
  loop = false,
  safeGroup = false,
  nearest = false,
  reverse = false,
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
  onPreviewHoldStart,
  onPreviewHoldEnd,
  onRemove,
}: ProgramSequenceRowProps) => {
  const warning = repairMessage ?? undefined;
  const accessibleLabel = [
    name,
    forced ? "强制轨迹" : null,
    loop ? "循环" : null,
    safeGroup ? SAFE_GROUP_LABEL : null,
    nearest ? NEAREST_LABEL : null,
    reverse ? REVERSE_LABEL : null,
    warning,
  ]
    .filter(Boolean)
    .join("，");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const holdActiveRef = useRef(false);
  const suppressClickRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => clearTimer(), []);

  const endHold = () => {
    clearTimer();
    if (!holdActiveRef.current) return;
    holdActiveRef.current = false;
    onPreviewHoldEnd?.();
    suppressClickRef.current = true;
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!onPreviewHoldStart || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("[data-row-chrome]")) return;
    suppressClickRef.current = false;
    startPointRef.current = { x: event.clientX, y: event.clientY };
    holdActiveRef.current = false;
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      holdActiveRef.current = true;
      onPreviewHoldStart();
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: PointerEvent) => {
    const start = startPointRef.current;
    if (!start || timerRef.current == null) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_PX) clearTimer();
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onClick?.();
  };

  return (
    <div
      role={role}
      aria-selected={ariaSelected ? true : undefined}
      aria-label={accessibleLabel}
      title={warning}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={handleClick}
      onDoubleClick={onDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onPointerCancel={endHold}
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        "group mx-1 flex min-h-[40px] cursor-pointer items-center gap-2 rounded-sm border-l-2 border-t-2 px-2 transition-colors",
        dropActive ? "border-t-primary" : "border-t-transparent",
        ariaSelected ? "border-l-primary bg-accent" : "border-l-transparent",
        !ariaSelected && (striped ? "bg-accent/40" : "bg-input-background"),
        "hover:bg-accent",
      )}
    >
      <span className="inline-flex shrink-0 items-center gap-0.5">
        {draggable ? (
          <span
            data-row-chrome=""
            role="button"
            tabIndex={0}
            aria-label={`拖动 ${name}`}
            draggable
            onDragStart={onDragStart}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
          </span>
        ) : (
          <span className="w-7 shrink-0" aria-hidden />
        )}
        {indexLabel ? (
          <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
            {indexLabel}
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-body-sm text-foreground">{name}</span>
      {forced ? <ForcedTrajectoryBadge /> : null}
      {loop ? <LoopBadge /> : null}
      {safeGroup ? <SafeGroupBadge /> : null}
      {nearest ? <NearestBadge /> : null}
      {reverse ? <ReverseBadge /> : null}
      {warning ? (
        <span className="shrink-0 text-body-sm text-warning">待修复</span>
      ) : null}
      {durationLabel ? (
        <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
          {durationLabel}
        </span>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          data-row-chrome=""
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
