import { formatClock, formatDate } from "./log-display";

export type TimeRange = { start: number; end: number };

/** 最大放大到 1s 跨度 */
export const MIN_VIEW_SPAN_MS = 1_000;
const DEFAULT_EMPTY_SPAN_MS = 3_600_000;
const FIT_PAD_RATIO = 0.03;
/** 数据只有一个点时的显示跨度 */
const MIN_FIT_SPAN_MS = 30_000;

export const recordsExtent = (records: readonly { timestamp: number }[]): TimeRange | null => {
  if (records.length === 0) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const record of records) {
    if (record.timestamp < start) start = record.timestamp;
    if (record.timestamp > end) end = record.timestamp;
  }
  return { start, end };
};

export const fitView = (bounds: TimeRange | null, now: number = Date.now()): TimeRange => {
  if (!bounds) return { start: now - DEFAULT_EMPTY_SPAN_MS, end: now };
  const span = bounds.end - bounds.start;
  if (span < MIN_FIT_SPAN_MS) {
    const center = (bounds.start + bounds.end) / 2;
    return { start: center - MIN_FIT_SPAN_MS / 2, end: center + MIN_FIT_SPAN_MS / 2 };
  }
  const pad = span * FIT_PAD_RATIO;
  return { start: bounds.start - pad, end: bounds.end + pad };
};

/** 以 anchor 为中心缩放；factor < 1 放大 */
export const zoomView = (
  view: TimeRange,
  factor: number,
  anchor: number = (view.start + view.end) / 2,
  maxSpan: number = Infinity,
): TimeRange => {
  const span = view.end - view.start;
  const nextSpan = Math.min(Math.max(span * factor, MIN_VIEW_SPAN_MS), Math.max(maxSpan, MIN_VIEW_SPAN_MS));
  const ratio = span > 0 ? (anchor - view.start) / span : 0.5;
  const start = anchor - ratio * nextSpan;
  return { start, end: start + nextSpan };
};

export const panView = (view: TimeRange, deltaMs: number): TimeRange => ({
  start: view.start + deltaMs,
  end: view.end + deltaMs,
});

/** t 不在可视范围内时，保持跨度把 t 移到中间 */
export const ensureVisible = (view: TimeRange, t: number): TimeRange => {
  if (t >= view.start && t <= view.end) return view;
  const half = (view.end - view.start) / 2;
  return { start: t - half, end: t + half };
};

/** 以窗口为中心、左右各留 padRatio 的视图 */
export const viewAround = (window: TimeRange, padRatio = 0.2): TimeRange => {
  const pad = (window.end - window.start) * padRatio;
  return { start: window.start - pad, end: window.end + pad };
};

const TICK_STEPS_MS = [
  100, 200, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
  900_000, 1_800_000, 3_600_000, 7_200_000, 10_800_000, 21_600_000, 43_200_000, 86_400_000,
];

export const pickTickStep = (spanMs: number, maxTicks: number): number =>
  TICK_STEPS_MS.find((step) => spanMs / step <= Math.max(1, maxTicks)) ??
  TICK_STEPS_MS[TICK_STEPS_MS.length - 1];

/** 按本地时间对齐的刻度 */
export const buildTicks = (view: TimeRange, step: number): number[] => {
  const offset = new Date(view.start).getTimezoneOffset() * 60_000;
  const ticks: number[] = [];
  for (
    let t = Math.ceil((view.start - offset) / step) * step + offset;
    t <= view.end && ticks.length < 500;
    t += step
  ) {
    ticks.push(t);
  }
  return ticks;
};

export const tickLabel = (t: number, step: number): string => {
  if (step >= 86_400_000) return formatDate(t);
  const clock = formatClock(t);
  if (step >= 60_000) return clock.slice(0, 5);
  if (step >= 1_000) return clock;
  return `${clock}.${Math.floor(new Date(t).getMilliseconds() / 100)}`;
};

export const timeToRatio = (view: TimeRange, t: number): number =>
  (t - view.start) / Math.max(1, view.end - view.start);
