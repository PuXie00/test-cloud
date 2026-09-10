import { TIMELINE_PAD_LEFT, formatTime, pxToMs } from "./timeline-data";
import { computeNiceTimeTicks, type TimelineTick } from "./timeline-ticks";
import { clampCursorMs, usedBandScreenRect, viewPxFromMs } from "./timeline-view-extent";

type TimelineRulerProps = {
  occupiedEndMs: number;
  viewStartMs: number;
  viewEndMs: number;
  cursorMs: number;
  contentWidth: number;
  pxPerSecond: number;
  onCursorChange: (ms: number) => void;
};

const tickHeight = (kind: TimelineTick["kind"]): string => {
  if (kind === "major") return "h-3";
  if (kind === "minor") return "h-2";
  return "h-1";
};

const tickColor = (kind: TimelineTick["kind"]): string => {
  if (kind === "major") return "bg-muted-foreground/70";
  if (kind === "minor") return "bg-border";
  return "bg-border/50";
};

export const TimelineRulerReadout = ({
  cursorMs,
  occupiedEndMs,
}: {
  cursorMs: number;
  occupiedEndMs: number;
}) => (
  <div className="flex h-8 shrink-0 items-center justify-end bg-muted px-2">
    <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">
      {formatTime(cursorMs)}
      <span className="text-muted-foreground/50"> / </span>
      {formatTime(occupiedEndMs)}
    </span>
  </div>
);

export const TimelineRuler = ({
  occupiedEndMs,
  viewStartMs,
  viewEndMs,
  cursorMs,
  contentWidth,
  pxPerSecond,
  onCursorChange,
}: TimelineRulerProps) => {
  const { ticks } = computeNiceTimeTicks(pxPerSecond, viewEndMs, viewStartMs);
  const used = usedBandScreenRect(occupiedEndMs, viewStartMs, pxPerSecond);

  const msFromClientX = (clientX: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    return clampCursorMs(viewStartMs + pxToMs(clientX - rect.left, pxPerSecond));
  };

  const handleScrubStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    if (typeof target.setPointerCapture === "function" && event.pointerId != null) {
      target.setPointerCapture(event.pointerId);
    }
    onCursorChange(msFromClientX(event.clientX, target));

    const handleMove = (moveEvent: PointerEvent) => {
      onCursorChange(msFromClientX(moveEvent.clientX, target));
    };
    const handleUp = () => {
      if (typeof target.releasePointerCapture === "function" && event.pointerId != null) {
        try {
          target.releasePointerCapture(event.pointerId);
        } catch {
          /* jsdom */
        }
      }
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <div
      className="sticky top-0 z-10 h-8 shrink-0 bg-muted"
      style={{ width: TIMELINE_PAD_LEFT + contentWidth }}
    >
      {used ? (
        <div
          data-timeline-used-band=""
          className="pointer-events-none absolute inset-y-0 bg-input-background"
          style={{ left: used.leftPx, width: used.widthPx }}
          aria-hidden
        />
      ) : null}
      <div
        data-timeline-unused-band=""
        className="pointer-events-none absolute inset-y-0 bg-background"
        style={{ left: used ? used.leftPx + used.widthPx : 0, right: 0 }}
        aria-hidden
      />
      <div
        className="relative h-full shrink-0 cursor-ew-resize"
        style={{ marginLeft: TIMELINE_PAD_LEFT, width: contentWidth }}
        onPointerDown={handleScrubStart}
        role="slider"
        aria-label="时间标尺（秒）"
        aria-valuemin={0}
        aria-valuemax={Math.max(viewEndMs, cursorMs)}
        aria-valuenow={cursorMs}
        tabIndex={0}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 5000 : 1000;
          if (event.key === "ArrowRight") {
            event.preventDefault();
            onCursorChange(clampCursorMs(cursorMs + step));
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onCursorChange(clampCursorMs(cursorMs - step));
          }
        }}
      >
        <div className="relative h-full w-full">
          {ticks.map((tick) => (
            <div
              key={`${tick.kind}-${tick.ms}`}
              className="absolute bottom-0 flex w-0 flex-col items-center justify-end"
              style={{ left: viewPxFromMs(tick.ms, viewStartMs, pxPerSecond) }}
              data-testid={
                tick.kind === "major"
                  ? tick.ms === 0
                    ? "timeline-zero-tick"
                    : "timeline-ruler-tick"
                  : undefined
              }
              data-tick-ms={String(tick.ms)}
            >
              {tick.kind === "major" && tick.label !== undefined && (
                <span className="whitespace-nowrap pb-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {tick.label}
                </span>
              )}
              <div
                className={`w-px ${tickHeight(tick.kind)} ${tickColor(tick.kind)}`}
                aria-hidden
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
