import { useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import { formatTime } from "./timeline-data";
import { viewPxFromMs } from "./timeline-view-extent";
import { DRAG_CLICK_THRESHOLD_PX, isAdditiveClick, useDragClickGuard } from "./suppress-click";

export type PoseMarkerProps = {
  blockId: string;
  atMs: number;
  label?: string;
  isInitialPose: boolean;
  /** 有轴不设定：空心菱形 */
  partial?: boolean;
  selected: boolean;
  invalid?: boolean;
  invalidMessage?: string;
  viewStartMs: number;
  pxPerSecond: number;
  /** additive：Ctrl/⌘ 单击加选或减选 */
  onSelect: (additive: boolean) => void;
  onMove: (atMs: number) => void;
  onMoveEnd?: () => void;
};

export const PoseMarker = ({
  blockId,
  atMs,
  label,
  isInitialPose,
  partial = false,
  selected,
  invalid = false,
  invalidMessage,
  viewStartMs,
  pxPerSecond,
  onSelect,
  onMove,
  onMoveEnd,
}: PoseMarkerProps) => {
  // 拖动时标签显示块实际所在的时刻（吸附、被拒绝后都以它为准）
  const [dragging, setDragging] = useState(false);
  const dragClick = useDragClickGuard();

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    // 拖完补的 click 不改选中，否则拖多选里的一个会只剩它
    if (dragClick.consumeDragClick()) return;
    onSelect(isAdditiveClick(event));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(false);
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    dragClick.pressStarted();
    const startX = event.clientX;
    const initialAtMs = atMs;
    let moved = false;

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_CLICK_THRESHOLD_PX) return;
      moved = true;
      const deltaMs = Math.round((dx / pxPerSecond) * 1000);
      const nextAtMs = Math.max(0, initialAtMs + deltaMs);
      setDragging(true);
      onMove(nextAtMs);
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
      data-timeline-time={String(atMs)}
      data-block-id={blockId}
      aria-label={`${isInitialPose ? `位姿 ${blockId} 起始位姿` : `位姿 ${blockId}`}${partial ? " 部分轴经过" : ""}`}
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
          partial
            ? cn(
                "border-2 bg-background",
                invalid ? "border-warning" : selected ? "border-primary" : "border-muted-foreground",
              )
            : invalid
              ? "bg-warning"
              : selected
                ? "bg-primary"
                : "bg-muted-foreground",
        )}
        aria-hidden
      />
      {isInitialPose ? (
        <span className="rounded-full -ml-1.5 text-[10px] font-medium text-white">
          起
        </span>
      ) : null}
      {dragging && (
        <span className="pointer-events-none absolute -top-5 left-1/2 z-40 -translate-x-1/2 rounded-sm bg-card px-1.5 py-0.5 font-mono text-mono-sm tabular-nums text-foreground">
          {formatTime(atMs)}
        </span>
      )}
    </button>
  );
};
