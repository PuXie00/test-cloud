import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  TIMELINE_H_SCROLL_HEIGHT_PX,
  hScrollThumbLayout,
  viewStartFromBarClick,
  viewStartFromThumbDrag,
} from "./timeline-view-extent";

export type TimelineHScrollProps = {
  viewStartMs: number;
  viewportMs: number;
  totEndMs: number;
  onViewStartChange: (ms: number) => void;
};

export const TimelineHScroll = ({
  viewStartMs,
  viewportMs,
  totEndMs,
  onViewStartChange,
}: TimelineHScrollProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidthPx, setTrackWidthPx] = useState(0);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setTrackWidthPx(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { thumbLeftPx, thumbWidthPx } = hScrollThumbLayout({
    viewStartMs,
    viewportMs,
    totEndMs,
    trackWidthPx,
  });

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const width = track.clientWidth || rect.width;
    const target = event.target;
    const clickedThumb =
      target instanceof Element && target.closest("[data-testid='timeline-h-scroll-thumb']");

    if (!clickedThumb) {
      onViewStartChange(
        viewStartFromBarClick({
          clickXPx: event.clientX - rect.left,
          trackWidthPx: width,
          totEndMs,
          viewportMs,
        }),
      );
      return;
    }

    const originX = event.clientX;
    const originViewStartMs = viewStartMs;
    const originTotEndMs = totEndMs;
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      onViewStartChange(
        viewStartFromThumbDrag({
          originViewStartMs,
          deltaPx: moveEvent.clientX - originX,
          trackWidthPx: width,
          originTotEndMs,
          viewportMs,
        }),
      );
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <div
      ref={trackRef}
      data-testid="timeline-h-scroll"
      role="scrollbar"
      aria-label="时间视口"
      aria-orientation="horizontal"
      tabIndex={0}
      className="relative w-full shrink-0 bg-muted"
      style={{ height: TIMELINE_H_SCROLL_HEIGHT_PX }}
      onPointerDown={handlePointerDown}
    >
      <div
        data-testid="timeline-h-scroll-thumb"
        className="absolute top-0 bottom-0 rounded-sm bg-border hover:bg-muted-foreground"
        style={{ left: thumbLeftPx, width: thumbWidthPx }}
      />
    </div>
  );
};
