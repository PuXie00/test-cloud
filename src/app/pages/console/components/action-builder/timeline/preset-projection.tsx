import { useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import { formatTime, msToPx } from "./timeline-data";
import { viewPxFromMs } from "./timeline-view-extent";
import { DRAG_CLICK_THRESHOLD_PX, isAdditiveClick, useDragClickGuard } from "./suppress-click";

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
  /** additive：Ctrl/⌘ 单击加选或减选 */
  onSelect: (additive: boolean) => void;
  onMove: (atMs: number) => void;
  onMoveEnd?: () => void;
  onResize?: (startMs: number, endMs: number, edge: "start" | "end") => void;
};

type DragKind = "move" | "start" | "end";

const useSelectHandlers = (
  onSelect: (additive: boolean) => void,
  consumeDragClick: () => boolean,
) => {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (consumeDragClick()) return;
    onSelect(isAdditiveClick(event));
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(false);
  };
  return { handleClick, handleKeyDown };
};

/** 按下后横移过阈值才开始拖；拖过的话松手时调 onDragEnd */
const attachPointerDrag = (
  startX: number,
  onDragMove: (dx: number) => void,
  onDragEnd: () => void,
) => {
  let moved = false;
  const handleMove = (moveEvent: globalThis.PointerEvent) => {
    const dx = moveEvent.clientX - startX;
    if (!moved && Math.abs(dx) < DRAG_CLICK_THRESHOLD_PX) return;
    moved = true;
    onDragMove(dx);
  };
  const handleUp = () => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    if (!moved) return;
    onDragEnd();
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
};

const attachTimeDrag = (
  startX: number,
  initialAtMs: number,
  pxPerSecond: number,
  onMove: (atMs: number) => void,
  onDrag: (kind: DragKind | null) => void,
  onMoveEnd?: () => void,
) => {
  attachPointerDrag(
    startX,
    (dx) => {
      const deltaMs = Math.round((dx / pxPerSecond) * 1000);
      onDrag("move");
      onMove(Math.max(0, initialAtMs + deltaMs));
    },
    () => {
      onDrag(null);
      onMoveEnd?.();
    },
  );
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
  // 拖动时标签显示块实际所在的时刻（吸附、被拒绝后都以它为准）
  const [dragKind, setDragKind] = useState<DragKind | null>(null);
  const dragClick = useDragClickGuard();
  const { handleClick, handleKeyDown } = useSelectHandlers(onSelect, dragClick.consumeDragClick);
  const handleDragKind = (kind: DragKind | null) => {
    if (kind === null) dragClick.dragEnded();
    setDragKind(kind);
  };

  if (kind === "static-preset") {
    const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      dragClick.pressStarted();
      attachTimeDrag(event.clientX, atMs, pxPerSecond, onMove, handleDragKind, onMoveEnd);
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
        {dragKind && (
          <span className="pointer-events-none absolute -top-5 left-1/2 z-40 -translate-x-1/2 rounded-sm bg-card px-1.5 py-0.5 font-mono text-mono-sm tabular-nums text-foreground">
            {formatTime(atMs)}
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
    dragClick.pressStarted();
    attachTimeDrag(event.clientX, startMs, pxPerSecond, onMove, handleDragKind, onMoveEnd);
  };

  const handleResizePointerDown =
    (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      if (!onResize) return;
      dragClick.pressStarted();
      const initialStart = startMs;
      const initialEnd = endMs;
      attachPointerDrag(
        event.clientX,
        (dx) => {
          const deltaMs = Math.round((dx / pxPerSecond) * 1000);
          setDragKind(edge);
          if (edge === "start") {
            const nextStart = Math.max(0, Math.min(initialStart + deltaMs, initialEnd - 1));
            onResize(nextStart, initialEnd, "start");
          } else {
            const nextEnd = Math.max(initialStart + 1, initialEnd + deltaMs);
            onResize(initialStart, nextEnd, "end");
          }
        },
        () => {
          handleDragKind(null);
          onMoveEnd?.();
        },
      );
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
      {dragKind && (
        <span className="pointer-events-none absolute -top-5 left-0 z-40 rounded-sm bg-card px-1.5 py-0.5 font-mono text-mono-sm tabular-nums text-foreground">
          {formatTime(dragKind === "end" ? endMs : startMs)}
        </span>
      )}
    </button>
  );
};
