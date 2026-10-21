import { useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import type { TimelineMarker } from "@/app/project/action-sequence/types";
import { TIMELINE_PAD_LEFT, formatTime } from "./timeline-data";
import { viewPxFromMs } from "./timeline-view-extent";
import { DRAG_CLICK_THRESHOLD_PX, isAdditiveClick, useDragClickGuard } from "./suppress-click";

/** 标记行高度，时间轴最下面一行（和 Blender 一样） */
export const MARKER_LANE_HEIGHT_PX = 20;
/** 名称最多这么宽，离下一个标记更近时再截短 */
const LABEL_MAX_PX = 160;
const GLYPH_PX = 10;

type MarkerFlagProps = {
  marker: TimelineMarker;
  selected: boolean;
  leftPx: number;
  labelMaxPx: number;
  pxPerSecond: number;
  onSelect: (additive: boolean) => void;
  onMove: (atMs: number) => void;
  onMoveEnd: () => void;
  onRename: () => void;
};

const MarkerFlag = ({
  marker,
  selected,
  leftPx,
  labelMaxPx,
  pxPerSecond,
  onSelect,
  onMove,
  onMoveEnd,
  onRename,
}: MarkerFlagProps) => {
  const [dragging, setDragging] = useState(false);
  const dragClick = useDragClickGuard();

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
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
    const initialAtMs = marker.atMs;
    let moved = false;
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_CLICK_THRESHOLD_PX) return;
      moved = true;
      setDragging(true);
      onMove(Math.max(0, initialAtMs + Math.round((dx / pxPerSecond) * 1000)));
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      if (!moved) return;
      setDragging(false);
      dragClick.dragEnded();
      onMoveEnd();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <button
      type="button"
      data-marker-id={marker.id}
      data-timeline-time={String(marker.atMs)}
      aria-label={`标记 ${marker.name}`}
      aria-pressed={selected}
      title={`${marker.name}（${formatTime(marker.atMs)} s）`}
      onClick={handleClick}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onRename();
      }}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      className="absolute inset-y-0 flex cursor-grab items-center gap-1 active:cursor-grabbing"
      style={{ left: leftPx }}
    >
      <span
        aria-hidden
        className={cn(
          "h-0 w-0 shrink-0 -translate-x-1/2 border-x-[5px] border-b-[8px] border-x-transparent",
          selected ? "border-b-primary" : "border-b-foreground/70",
        )}
      />
      <span
        className={cn(
          "-ml-1 truncate text-[11px] leading-none",
          selected ? "font-semibold text-primary" : "text-foreground/80",
        )}
        style={{ maxWidth: labelMaxPx }}
      >
        {marker.name}
      </span>
      {dragging && (
        <span className="pointer-events-none absolute bottom-full left-0 z-40 mb-0.5 -translate-x-1/2 rounded-sm bg-card px-1.5 py-0.5 font-mono text-mono-sm tabular-nums text-foreground">
          {formatTime(marker.atMs)}
        </span>
      )}
    </button>
  );
};

export type TimelineMarkerLaneProps = {
  /** 按时刻排好 */
  markers: readonly TimelineMarker[];
  selectedMarkerIds: readonly string[];
  /** 这一行盖住了时间轴的指针线，自己再画一段 */
  cursorMs: number;
  viewStartMs: number;
  pxPerSecond: number;
  contentWidth: number;
  onSelect: (marker: TimelineMarker, additive: boolean) => void;
  onMove: (marker: TimelineMarker, atMs: number) => void;
  onMoveEnd: () => void;
  onRename: (marker: TimelineMarker) => void;
};

/** 时间轴最下面的标记行：朝上的小三角加名称，可以点选、拖动、双击改名；纵向滚动时贴在底部 */
export const TimelineMarkerLane = ({
  markers,
  selectedMarkerIds,
  cursorMs,
  viewStartMs,
  pxPerSecond,
  contentWidth,
  onSelect,
  onMove,
  onMoveEnd,
  onRename,
}: TimelineMarkerLaneProps) => (
  <div
    data-testid="timeline-marker-lane"
    className="sticky bottom-0 z-[35] shrink-0 overflow-x-clip border-t border-border/40 bg-muted"
    style={{ width: TIMELINE_PAD_LEFT + contentWidth, height: MARKER_LANE_HEIGHT_PX }}
  >
    <div className="relative h-full" style={{ marginLeft: TIMELINE_PAD_LEFT, width: contentWidth }}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary"
        style={{ left: viewPxFromMs(cursorMs, viewStartMs, pxPerSecond) }}
      />
      {markers.map((marker, index) => {
        const leftPx = viewPxFromMs(marker.atMs, viewStartMs, pxPerSecond);
        const next = markers[index + 1];
        const gapPx =
          next === undefined
            ? LABEL_MAX_PX
            : viewPxFromMs(next.atMs, viewStartMs, pxPerSecond) - leftPx - GLYPH_PX;
        return (
          <MarkerFlag
            key={marker.id}
            marker={marker}
            selected={selectedMarkerIds.includes(marker.id)}
            leftPx={leftPx}
            labelMaxPx={Math.max(0, Math.min(LABEL_MAX_PX, gapPx))}
            pxPerSecond={pxPerSecond}
            onSelect={(additive) => onSelect(marker, additive)}
            onMove={(atMs) => onMove(marker, atMs)}
            onMoveEnd={onMoveEnd}
            onRename={() => onRename(marker)}
          />
        );
      })}
    </div>
  </div>
);
