import { cn } from "@/app/components/ui/utils";
import { TIME_STEP_MS, TIMELINE_PAD_LEFT, formatTime, msToPx, pxToMs } from "./timeline-data";
import { computeNiceTimeTicks, type TimelineTick } from "./timeline-ticks";
import { clampCursorMs, usedBandScreenRect, viewPxFromMs } from "./timeline-view-extent";

/** 标尺上的一列：这一时刻有位姿（或静态预设）；selected 为这一列全都选中了 */
export type RulerColumn = { atMs: number; selected: boolean };

type TimelineRulerProps = {
  occupiedEndMs: number;
  viewStartMs: number;
  viewEndMs: number;
  cursorMs: number;
  contentWidth: number;
  pxPerSecond: number;
  onCursorChange: (ms: number) => void;
  /** 鼠标拖动指针（可吸附）；不传时用 onCursorChange */
  onScrub?: (ms: number) => void;
  /** 按下标尺交给时间轴处理（跳游标并拖、贴边自动滚、Shift 拖选时间段）；不传时标尺自己拖游标 */
  onScrubStart?: (event: React.PointerEvent<HTMLDivElement>) => void;
  /** 有位姿的时刻画成小菱形：点它选整列，拖它挪整列 */
  columns?: readonly RulerColumn[];
  onColumnPointerDown?: (column: RulerColumn, event: React.PointerEvent<HTMLButtonElement>) => void;
  /** Shift 拖出来的时间段 */
  rangeMs?: { startMs: number; endMs: number } | null;
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
  onScrub = onCursorChange,
  onScrubStart,
  columns = [],
  onColumnPointerDown,
  rangeMs = null,
}: TimelineRulerProps) => {
  const { ticks } = computeNiceTimeTicks(pxPerSecond, viewEndMs, viewStartMs);
  const used = usedBandScreenRect(occupiedEndMs, viewStartMs, pxPerSecond);

  const msFromClientX = (clientX: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    return clampCursorMs(viewStartMs + pxToMs(clientX - rect.left, pxPerSecond));
  };

  const handleScrubStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (onScrubStart) {
      onScrubStart(event);
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    if (typeof target.setPointerCapture === "function" && event.pointerId != null) {
      target.setPointerCapture(event.pointerId);
    }
    onScrub(msFromClientX(event.clientX, target));

    const handleMove = (moveEvent: PointerEvent) => {
      onScrub(msFromClientX(moveEvent.clientX, target));
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
          // Alt+←/→ 是跳关键帧，由编辑区处理
          if (event.altKey) return;
          const step = event.shiftKey ? TIME_STEP_MS * 10 : TIME_STEP_MS;
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
          {rangeMs ? (
            <div
              data-testid="timeline-ruler-range"
              className="pointer-events-none absolute inset-y-0 bg-primary/20"
              style={{
                left: viewPxFromMs(Math.min(rangeMs.startMs, rangeMs.endMs), viewStartMs, pxPerSecond),
                width: msToPx(Math.abs(rangeMs.endMs - rangeMs.startMs), pxPerSecond),
              }}
              aria-hidden
            />
          ) : null}
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
          {columns
            .filter((column) => column.atMs >= viewStartMs && column.atMs <= viewEndMs)
            .map((column) => (
              <button
                key={column.atMs}
                type="button"
                tabIndex={-1}
                data-testid="timeline-ruler-column"
                data-at-ms={String(column.atMs)}
                aria-label={`整列 ${formatTime(column.atMs)} s`}
                aria-pressed={column.selected}
                title={`${formatTime(column.atMs)} s：点选这一列的全部位姿（Ctrl 加选），拖动整列一起挪`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onColumnPointerDown?.(column, event);
                }}
                className="absolute bottom-0 z-[1] flex h-3 w-3 -translate-x-1/2 cursor-grab items-center justify-center active:cursor-grabbing"
                style={{ left: viewPxFromMs(column.atMs, viewStartMs, pxPerSecond) }}
              >
                <span
                  className={cn(
                    "size-[7px] rotate-45",
                    column.selected ? "bg-primary" : "bg-muted-foreground/60 hover:bg-foreground",
                  )}
                  aria-hidden
                />
              </button>
            ))}
        </div>
      </div>
    </div>
  );
};
