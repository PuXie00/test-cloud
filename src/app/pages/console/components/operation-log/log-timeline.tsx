import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { LogCategory, LogRecord } from "@shared/csocket/operation-log";
import { cn } from "@/app/components/ui/utils";
import {
  CATEGORY_LABEL,
  formatClock,
  formatClockMs,
  formatDateTime,
  formatSpan,
  isFailedOperation,
  isRaisedAlarm,
  logBadge,
} from "./log-display";
import {
  buildTicks,
  panView,
  pickTickStep,
  tickLabel,
  timeToRatio,
  zoomView,
  type TimeRange,
} from "./timeline-scale";

/** 快照不是独立记录：报警发生时写入，画成该报警快照时间段的色条 */
type Lane = LogCategory | "snapshot";
const LANES: Lane[] = ["operation", "alarm", "snapshot", "system"];
const LANE_LABEL: Record<Lane, string> = { ...CATEGORY_LABEL, snapshot: "快照" };
const ZOOM_STEP = 1.5;
const WHEEL_ZOOM = 1.25;
/** 移动超过这个像素才算拖拽，否则算点击 */
const DRAG_THRESHOLD_PX = 3;
const TICK_MIN_GAP_PX = 96;

const markerVisual = (record: LogRecord): string => {
  switch (record.category) {
    case "operation":
      return isFailedOperation(record)
        ? "h-3.5 w-[3px] rounded-[1px] bg-destructive"
        : "h-3.5 w-[3px] rounded-[1px] bg-primary";
    case "alarm":
      if (record.alarmState === "cleared") return "h-2 w-2 rotate-45 border border-show bg-background";
      return cn("h-2.5 w-2.5 rotate-45", record.alarmLevel === 1 ? "bg-warning" : "bg-destructive");
    case "system":
      return cn(
        "h-3 w-[3px] rounded-[1px]",
        record.level === "error"
          ? "bg-destructive"
          : record.level === "warning"
            ? "bg-warning"
            : record.level === "debug"
              ? "bg-muted-foreground/50"
              : "bg-muted-foreground",
      );
  }
};

type DragState = { pointerX: number; view: TimeRange; moved: boolean; mode: "pan" | "scrub" };

type LogTimelineProps = {
  records: LogRecord[];
  view: TimeRange;
  onViewChange: (view: TimeRange) => void;
  onFit: () => void;
  /** 缩小上限 */
  maxSpan: number;
  cursor: number | null;
  onCursorChange: (t: number) => void;
  selectedId: string | null;
  onSelect: (record: LogRecord) => void;
  /** 报警回看窗口 */
  highlight: TimeRange | null;
};

export const LogTimeline = ({
  records,
  view,
  onViewChange,
  onFit,
  maxSpan,
  cursor,
  onCursorChange,
  selectedId,
  onSelect,
  highlight,
}: LogTimelineProps) => {
  const areaRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [width, setWidth] = useState(800);
  const latest = useRef({ view, onViewChange, maxSpan });
  latest.current = { view, onViewChange, maxSpan };

  useEffect(() => {
    const el = areaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(1, entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // React 的 onWheel 是 passive，阻止不了页面滚动，这里手动挂
  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { view: current, onViewChange: change, maxSpan: limit } = latest.current;
      const rect = el.getBoundingClientRect();
      const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
      const anchor = current.start + ratio * (current.end - current.start);
      change(zoomView(current, event.deltaY > 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM, anchor, limit));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const span = view.end - view.start;
  const step = pickTickStep(span, Math.floor(width / TICK_MIN_GAP_PX));
  const ticks = useMemo(() => buildTicks(view, step), [view, step]);
  const visible = useMemo(() => {
    const margin = span * 0.01;
    return records.filter((r) => r.timestamp >= view.start - margin && r.timestamp <= view.end + margin);
  }, [records, view, span]);
  const byLane = useMemo(() => {
    const lanes = new Map<Lane, LogRecord[]>(LANES.map((lane) => [lane, []]));
    for (const record of visible) lanes.get(record.category)?.push(record);
    return lanes;
  }, [visible]);
  const snapshots = useMemo(
    () =>
      records.filter(
        (r) =>
          isRaisedAlarm(r) &&
          r.snapshotRange &&
          r.snapshotRange.end >= view.start &&
          r.snapshotRange.start <= view.end,
      ),
    [records, view],
  );

  const timeAt = (clientX: number) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return view.start;
    return view.start + ((clientX - rect.left) / rect.width) * span;
  };
  const percent = (t: number) => `${timeToRatio(view, t) * 100}%`;

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, mode: DragState["mode"]) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-marker]")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerX: event.clientX, view, moved: false, mode };
    if (mode === "scrub") onCursorChange(timeAt(event.clientX));
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.pointerX;
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    if (drag.mode === "scrub") {
      onCursorChange(timeAt(event.clientX));
      return;
    }
    const dragSpan = drag.view.end - drag.view.start;
    onViewChange(panView(drag.view, (-dx / width) * dragSpan));
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.mode === "pan" && !drag.moved) onCursorChange(timeAt(event.clientX));
  };

  const cursorInView = cursor != null && cursor >= view.start && cursor <= view.end ? cursor : null;

  const zoomBy = (factor: number) =>
    onViewChange(zoomView(view, factor, cursorInView ?? undefined, maxSpan));


  return (
    <section className="flex shrink-0 flex-col border-b border-border bg-card" aria-label="统一时间线">
      <div className="flex h-8 items-center gap-3 px-3">
        <h3 className="text-label-caps text-muted-foreground">统一时间线</h3>
        <span className="truncate font-mono text-mono-sm tabular-nums text-muted-foreground">
          {formatDateTime(view.start)} – {formatClock(view.end)} · 跨度 {formatSpan(span)}
        </span>
        <span className="ml-auto hidden text-label-caps text-muted-foreground lg:inline">
          滚轮缩放 · 拖动平移 · 点击定位游标
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="缩小"
            onClick={() => zoomBy(ZOOM_STEP)}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="放大"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="适应全部"
            onClick={onFit}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex px-3 pb-1">
        <div className="flex w-10 shrink-0 flex-col">
          {LANES.map((lane) => (
            <span key={lane} className="flex h-6 items-center text-label-caps text-muted-foreground">
              {LANE_LABEL[lane]}
            </span>
          ))}
        </div>

        <div ref={areaRef} className="relative min-w-0 flex-1 overflow-hidden">
          <div
            ref={lanesRef}
            className="relative cursor-grab touch-none select-none rounded-sm bg-background active:cursor-grabbing"
            onPointerDown={(event) => startDrag(event, "pan")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
          >
            {highlight && (
              <div
                className="pointer-events-none absolute inset-y-0 bg-destructive/10"
                style={{
                  left: percent(highlight.start),
                  width: `${((highlight.end - highlight.start) / Math.max(1, span)) * 100}%`,
                }}
                aria-hidden
              />
            )}
            {ticks.map((t) => (
              <div
                key={t}
                className="pointer-events-none absolute inset-y-0 w-px bg-border/40"
                style={{ left: percent(t) }}
                aria-hidden
              />
            ))}
            {LANES.map((lane) => (
              <div key={lane} className="relative h-6 border-b border-border/30 last:border-b-0">
                {lane === "snapshot" &&
                  snapshots.map((alarm) => {
                    const range = alarm.snapshotRange!;
                    const selected = alarm.id === selectedId;
                    return (
                      <button
                        key={alarm.id}
                        type="button"
                        data-marker
                        title={`状态快照 ${formatClock(range.start)} – ${formatClock(range.end)} · ${alarm.message}`}
                        aria-label={`${alarm.message} 的状态快照`}
                        aria-pressed={selected}
                        onClick={() => onSelect(alarm)}
                        className={cn(
                          "absolute top-1/2 h-3 min-w-1 -translate-y-1/2 rounded-sm border",
                          selected
                            ? "z-10 border-foreground bg-info/50"
                            : "border-info/60 bg-info/25 hover:bg-info/40",
                        )}
                        style={{
                          left: percent(range.start),
                          width: `${((range.end - range.start) / Math.max(1, span)) * 100}%`,
                        }}
                      />
                    );
                  })}
                {byLane.get(lane)?.map((record) => {
                  const selected = record.id === selectedId;
                  return (
                    <button
                      key={record.id}
                      type="button"
                      data-marker
                      title={`${formatClockMs(record.timestamp)} ${logBadge(record).label} ${record.message}`}
                      aria-label={`${formatClock(record.timestamp)} ${record.message}`}
                      aria-pressed={selected}
                      onClick={() => onSelect(record)}
                      className={cn(
                        "absolute top-1/2 flex h-5 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm",
                        selected ? "z-10 bg-foreground/20 ring-1 ring-foreground" : "hover:bg-foreground/10",
                      )}
                      style={{ left: percent(record.timestamp) }}
                    >
                      <span className={markerVisual(record)} aria-hidden />
                    </button>
                  );
                })}
              </div>
            ))}
            {cursorInView != null && (
              <div
                className="pointer-events-none absolute inset-y-0 z-20 w-px bg-foreground"
                style={{ left: percent(cursorInView) }}
                aria-hidden
              />
            )}
          </div>

          <div
            className="relative h-5 cursor-ew-resize touch-none select-none"
            onPointerDown={(event) => startDrag(event, "scrub")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
            role="slider"
            aria-label="游标时刻"
            aria-valuemin={view.start}
            aria-valuemax={view.end}
            aria-valuenow={cursor ?? undefined}
            aria-valuetext={cursor != null ? formatClockMs(cursor) : "未定位"}
          >
            {ticks.map((t) => (
              <span
                key={t}
                className="pointer-events-none absolute top-0.5 -translate-x-1/2 whitespace-nowrap font-mono text-mono-sm tabular-nums text-muted-foreground"
                style={{ left: percent(t) }}
              >
                {tickLabel(t, step)}
              </span>
            ))}
            {cursorInView != null && (
              <span
                className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-sm bg-foreground px-1 font-mono text-mono-sm tabular-nums text-background"
                style={{ left: percent(cursorInView) }}
              >
                {formatClockMs(cursorInView)}
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
