import { useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import { formatTime } from "./timeline-data";
import { viewPxFromMs } from "./timeline-view-extent";

export type PoseMarkerProps = {
  blockId: string;
  atMs: number;
  label?: string;
  isInitialPose: boolean;
  selected: boolean;
  invalid?: boolean;
  invalidMessage?: string;
  viewStartMs: number;
  pxPerSecond: number;
  onSelect: () => void;
  onMove: (atMs: number) => void;
  onMoveEnd?: () => void;
};

export const PoseMarker = ({
  blockId,
  atMs,
  label,
  isInitialPose,
  selected,
  invalid = false,
  invalidMessage,
  viewStartMs,
  pxPerSecond,
  onSelect,
  onMove,
  onMoveEnd,
}: PoseMarkerProps) => {
  const [dragLabel, setDragLabel] = useState<string | null>(null);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onSelect();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const startX = event.clientX;
    const initialAtMs = atMs;

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const deltaMs = Math.round(((moveEvent.clientX - startX) / pxPerSecond) * 1000);
      const nextAtMs = Math.max(0, initialAtMs + deltaMs);
      setDragLabel(formatTime(nextAtMs));
      onMove(nextAtMs);
    };

    const handleUp = () => {
      setDragLabel(null);
      onMoveEnd?.();
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <button
      type="button"
      data-timeline-time={String(atMs)}
      data-block-id={blockId}
      aria-label={isInitialPose ? `位姿 ${blockId} 起始位姿` : `位姿 ${blockId}`}
      aria-pressed={selected}
      aria-invalid={invalid || undefined}
      data-invalid={invalid ? "true" : undefined}
      title={invalid ? (invalidMessage ?? label) : label}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      className={cn(
        "absolute top-1/2 z-10 flex -translate-y-1/2 cursor-grab items-center gap-1 active:cursor-grabbing",
      )}
      style={{ left: viewPxFromMs(atMs, viewStartMs, pxPerSecond) }}
    >
      <span
        className={cn(
          "size-2.5 shrink-0 -translate-x-1/2 rotate-45",
          invalid ? "bg-warning" : selected ? "bg-primary" : "bg-muted-foreground",
        )}
        aria-hidden
      />
      {isInitialPose ? (
        <span className="rounded-full -ml-1.5 text-[10px] font-medium text-white">
          起
        </span>
      ) : null}
      {dragLabel && (
        <span className="pointer-events-none absolute -top-5 left-1/2 z-40 -translate-x-1/2 rounded-sm bg-card px-1.5 py-0.5 font-mono text-mono-sm tabular-nums text-foreground">
          {dragLabel}
        </span>
      )}
    </button>
  );
};
