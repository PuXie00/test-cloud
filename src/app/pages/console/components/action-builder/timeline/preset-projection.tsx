import { useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import { formatTime, msToPx } from "./timeline-data";
import { viewPxFromMs } from "./timeline-view-extent";

export type PresetProjectionProps = {
  blockId: string;
  kind: "static-preset" | "dynamic-preset";
  label: string;
  atMs?: number;
  startMs?: number;
  endMs?: number;
  generatedAtMs?: number[];
  initialPoseAtMs?: number;
  selected: boolean;
  invalid?: boolean;
  invalidMessage?: string;
  viewStartMs: number;
  pxPerSecond: number;
  onSelect: () => void;
  onMove: (atMs: number) => void;
  onMoveEnd?: () => void;
  onResize?: (startMs: number, endMs: number) => void;
};

const useSelectHandlers = (onSelect: () => void) => {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onSelect();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  };
  return { handleClick, handleKeyDown };
};

const attachTimeDrag = (
  startX: number,
  initialAtMs: number,
  pxPerSecond: number,
  onMove: (atMs: number) => void,
  onLabel: (label: string | null) => void,
  onMoveEnd?: () => void,
) => {
  const handleMove = (moveEvent: globalThis.PointerEvent) => {
    const deltaMs = Math.round(((moveEvent.clientX - startX) / pxPerSecond) * 1000);
    const nextAtMs = Math.max(0, initialAtMs + deltaMs);
    onLabel(formatTime(nextAtMs));
    onMove(nextAtMs);
  };
  const handleUp = () => {
    onLabel(null);
    onMoveEnd?.();
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
};

const GENERATED_TICK_WIDTH_PX = 1;

const generatedTickOffsetPx = (
  tickMs: number,
  startMs: number,
  widthPx: number,
  pxPerSecond: number,
): number => {
  const offsetPx = msToPx(tickMs - startMs, pxPerSecond);
  return Math.min(Math.max(offsetPx, 0), Math.max(widthPx - GENERATED_TICK_WIDTH_PX, 0));
};

export const PresetProjection = ({
  blockId,
  kind,
  label,
  atMs = 0,
  startMs = 0,
  endMs = 0,
  generatedAtMs = [],
  initialPoseAtMs,
  selected,
  invalid = false,
  invalidMessage,
  viewStartMs,
  pxPerSecond,
  onSelect,
  onMove,
  onMoveEnd,
  onResize,
}: PresetProjectionProps) => {
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const { handleClick, handleKeyDown } = useSelectHandlers(onSelect);

  if (kind === "static-preset") {
    const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      attachTimeDrag(event.clientX, atMs, pxPerSecond, onMove, setDragLabel, onMoveEnd);
    };

    return (
      <button
        type="button"
        data-block-id={blockId}
        data-timeline-time={String(atMs)}
        aria-label={
          initialPoseAtMs !== undefined ? `静态预设 ${label} 起始位姿` : `静态预设 ${label}`
        }
        aria-pressed={selected}
        aria-invalid={invalid || undefined}
        data-invalid={invalid ? "true" : undefined}
        title={invalid ? invalidMessage : undefined}
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        className={cn(
          "absolute top-1/2 z-10 flex -translate-y-1/2 cursor-grab items-center gap-1 active:cursor-grabbing",
          invalid && "rounded-sm bg-warning/75",
          selected ? "text-primary" : "text-secondary",
        )}
        style={{ left: viewPxFromMs(atMs, viewStartMs, pxPerSecond) }}
      >
        <span
          className={cn(
            "size-2.5 shrink-0 -translate-x-1/2 rotate-45",
            invalid ? "bg-warning" : selected ? "bg-primary" : "bg-secondary",
          )}
          aria-hidden
        />
        {initialPoseAtMs !== undefined ? (
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
  }

  const durationMs = Math.max(endMs - startMs, 1);
  const widthPx = Math.max(msToPx(durationMs, pxPerSecond), 1);

  const handleMovePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    attachTimeDrag(event.clientX, startMs, pxPerSecond, onMove, setDragLabel, onMoveEnd);
  };

  const handleResizePointerDown =
    (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      if (!onResize) return;
      const originX = event.clientX;
      const initialStart = startMs;
      const initialEnd = endMs;

      const handleMove = (moveEvent: globalThis.PointerEvent) => {
        const deltaMs = Math.round(((moveEvent.clientX - originX) / pxPerSecond) * 1000);
        if (edge === "start") {
          const nextStart = Math.max(0, Math.min(initialStart + deltaMs, initialEnd - 1));
          setDragLabel(formatTime(nextStart));
          onResize(nextStart, initialEnd);
        } else {
          const nextEnd = Math.max(initialStart + 1, initialEnd + deltaMs);
          setDragLabel(formatTime(nextEnd));
          onResize(initialStart, nextEnd);
        }
      };
      const handleUp = () => {
        setDragLabel(null);
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    };

  return (
    <button
      type="button"
      data-block-id={blockId}
      data-timeline-time={String(startMs)}
      aria-label={
        initialPoseAtMs !== undefined ? `动态预设 ${label} 起始位姿` : `动态预设 ${label}`
      }
      aria-pressed={selected}
      aria-invalid={invalid || undefined}
      data-invalid={invalid ? "true" : undefined}
      title={invalid ? invalidMessage : undefined}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={handleMovePointerDown}
      className={cn(
        "absolute top-1 z-10 flex h-[calc(100%-8px)] items-center rounded-sm px-1",
        invalid
          ? selected
            ? "bg-warning/75 text-warning"
            : "bg-warning/75 text-muted-foreground"
          : selected
            ? "bg-primary/75 text-foreground"
            : "bg-secondary/40 text-muted-foreground",
      )}
      style={{
        left: viewPxFromMs(startMs, viewStartMs, pxPerSecond),
        width: widthPx,
      }}
    >
      <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-sm" aria-hidden>
        {generatedAtMs.map((tickMs) => (
          <span
            key={tickMs}
            data-generated-tick=""
            data-at-ms={String(tickMs)}
            className="absolute top-0.5 h-2 w-px bg-foreground/70"
            style={{
              left: generatedTickOffsetPx(tickMs, startMs, widthPx, pxPerSecond),
            }}
          />
        ))}
      </span>
      <span
        data-resize="start"
        className="absolute left-0 top-0 z-10 h-full w-2 cursor-ew-resize"
        onPointerDown={handleResizePointerDown("start")}
      />
      {initialPoseAtMs !== undefined ? (
        <span
          className="pointer-events-none absolute top-1/2 z-[1] -translate-y-1/2 rounded-full text-[10px] font-medium text-white"
          style={{ left: msToPx(initialPoseAtMs - startMs, pxPerSecond) }}
        >
          起
        </span>
      ) : null}
      <span
        data-resize="end"
        className="absolute right-0 top-0 z-10 h-full w-2 cursor-ew-resize"
        onPointerDown={handleResizePointerDown("end")}
      />
      {dragLabel && (
        <span className="pointer-events-none absolute -top-5 left-0 z-40 rounded-sm bg-card px-1.5 py-0.5 font-mono text-mono-sm tabular-nums text-foreground">
          {dragLabel}
        </span>
      )}
    </button>
  );
};
