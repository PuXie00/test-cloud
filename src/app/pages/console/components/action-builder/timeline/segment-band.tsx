import { useState, type MouseEvent, type PointerEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import { formatTime, msToPx } from "./timeline-data";
import { viewPxFromMs } from "./timeline-view-extent";
import { DRAG_CLICK_THRESHOLD_PX, isAdditiveClick, useDragClickGuard } from "./suppress-click";

export type SegmentBandProps = {
  objectId: number;
  fromRef: string;
  toRef: string;
  startMs: number;
  endMs: number;
  selected: boolean;
  invalid?: boolean;
  invalidMessage?: string;
  viewStartMs: number;
  pxPerSecond: number;
  /** additive：Ctrl/⌘ 单击加选或减选 */
  onSelect: (additive: boolean) => void;
  /** 拖动区间：startMs 是区间起点想去的时刻；不传时不能拖 */
  onMove?: (startMs: number) => void;
  onMoveEnd?: () => void;
};

export const SegmentBand = ({
  objectId,
  fromRef,
  toRef,
  startMs,
  endMs,
  selected,
  invalid = false,
  invalidMessage,
  viewStartMs,
  pxPerSecond,
  onSelect,
  onMove,
  onMoveEnd,
}: SegmentBandProps) => {
  const durationMs = endMs - startMs;
  // 拖动时标签显示区间起点实际所在的时刻
  const [dragging, setDragging] = useState(false);
  const dragClick = useDragClickGuard();

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (dragClick.consumeDragClick()) return;
    onSelect(isAdditiveClick(event));
  };

  // 按住 Shift 拖动交给时间轴框选；直接拖动是平移
  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || event.shiftKey || !onMove) return;
    event.stopPropagation();
    dragClick.pressStarted();
    const startX = event.clientX;
    const initialStartMs = startMs;
    let moved = false;

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_CLICK_THRESHOLD_PX) return;
      moved = true;
      setDragging(true);
      onMove(Math.max(0, initialStartMs + Math.round((dx / pxPerSecond) * 1000)));
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      if (!moved) return;
      setDragging(false);
      dragClick.dragEnded();
      onMoveEnd?.();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <button
      type="button"
      aria-label={`运动区间 ${objectId} ${durationMs}ms`}
      title={invalid ? (invalidMessage ?? "") : ""}
      aria-pressed={selected}
      aria-invalid={invalid || undefined}
      data-invalid={invalid ? "true" : undefined}
      data-from-ref={fromRef}
      data-to-ref={toRef}
      data-marquee-start=""
      tabIndex={0}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      className={cn(
        "absolute top-1/2 z-0 flex h-5 -translate-y-1/2 items-center justify-center overflow-visible rounded-sm px-1",
        onMove && "cursor-grab active:cursor-grabbing",
        invalid
          ? selected
            ? "bg-warning/75 text-warning"
            : "bg-warning/75 text-warning"
          : selected
            ? " bg-primary/75"
            : "bg-secondary/15 text-muted-foreground",
      )}
      style={{
        left: viewPxFromMs(startMs, viewStartMs, pxPerSecond),
        width: Math.max(msToPx(durationMs, pxPerSecond), 1),
      }}
    >
      {dragging && (
        <span className="pointer-events-none absolute -top-5 left-0 z-40 rounded-sm bg-card px-1.5 py-0.5 font-mono text-mono-sm tabular-nums text-foreground">
          {formatTime(startMs)}
        </span>
      )}
    </button>
  );
};
