import { TIMELINE_PAD_LEFT, msToPx, pxToMs, snapTimeMs } from "./timeline-data";

export const MARQUEE_THRESHOLD_PX = 6;
export const POINT_BLOCK_HIT_MIN_PX = 12;

export const viewportDurationMs = (viewportWidthPx: number, pxPerSecond: number): number => {
  const timedPx = Math.max(viewportWidthPx - TIMELINE_PAD_LEFT, 1);
  const pps = Math.max(pxPerSecond, 0.001);
  return Math.round((timedPx / pps) * 1000);
};

export const usedBandWidthPx = (occupiedEndMs: number, pxPerSecond: number): number => {
  if (occupiedEndMs <= 0) return 0;
  return msToPx(occupiedEndMs, pxPerSecond);
};

export const clampCursorMs = (ms: number): number => snapTimeMs(ms);

export const TIMELINE_H_SCROLL_HEIGHT_PX = 8;
export const TIMELINE_H_SCROLL_MIN_THUMB_PX = 24;

export const viewWindowEndMs = (viewStartMs: number, viewportMs: number): number =>
  viewStartMs + viewportMs;

/** 播放中游标跑出窗口时平移 viewStart，使游标落在 [viewStart, viewEnd) 内。 */
export const followPlayheadViewStart = (input: {
  cursorMs: number;
  viewStartMs: number;
  viewportMs: number;
}): number => {
  if (input.viewportMs <= 0) return clampViewStartMs(input.viewStartMs);
  if (input.cursorMs < input.viewStartMs) return clampViewStartMs(input.cursorMs);
  const viewEndMs = viewWindowEndMs(input.viewStartMs, input.viewportMs);
  if (input.cursorMs < viewEndMs) return input.viewStartMs;
  return clampViewStartMs(input.cursorMs - input.viewportMs + 1);
};

export const totEndMs = (occupiedEndMs: number, viewEndMs: number, viewportMs: number): number =>
  Math.max(occupiedEndMs, viewEndMs, viewportMs);

export const clampViewStartMs = (ms: number): number => Math.max(0, Math.round(ms));

export const panViewStartMs = (
  viewStartMs: number,
  deltaPx: number,
  pxPerSecond: number,
): number => clampViewStartMs(viewStartMs - pxToMs(deltaPx, pxPerSecond));

export const viewStartForZoomAnchor = (input: {
  anchorMs: number;
  pointerXFromPad: number;
  nextPxPerSecond: number;
}): number =>
  clampViewStartMs(input.anchorMs - pxToMs(input.pointerXFromPad, input.nextPxPerSecond));

export const canvasWidthPx = (paneWidthPx: number): number =>
  Math.max(Math.round(paneWidthPx), TIMELINE_PAD_LEFT + 1);

export const viewPxFromMs = (tMs: number, viewStartMs: number, pxPerSecond: number): number =>
  msToPx(tMs - viewStartMs, pxPerSecond);

export const usedBandScreenRect = (
  occupiedEndMs: number,
  viewStartMs: number,
  pxPerSecond: number,
): { leftPx: number; widthPx: number } | null => {
  if (occupiedEndMs <= 0) return null;
  const timedWidth = msToPx(occupiedEndMs, pxPerSecond);
  if (viewStartMs === 0) {
    return { leftPx: 0, widthPx: TIMELINE_PAD_LEFT + timedWidth };
  }
  return {
    leftPx: TIMELINE_PAD_LEFT + msToPx(-viewStartMs, pxPerSecond),
    widthPx: timedWidth,
  };
};

export const hScrollThumbLayout = (input: {
  viewStartMs: number;
  viewportMs: number;
  totEndMs: number;
  trackWidthPx: number;
}): { thumbLeftPx: number; thumbWidthPx: number } => {
  const tot = Math.max(input.totEndMs, 1);
  const track = Math.max(input.trackWidthPx, 1);
  const thumbWidthPx = Math.min(
    track,
    Math.max(TIMELINE_H_SCROLL_MIN_THUMB_PX, (input.viewportMs / tot) * track),
  );
  const maxViewStart = Math.max(tot - input.viewportMs, 0);
  const travel = Math.max(track - thumbWidthPx, 0);
  const thumbLeftPx =
    maxViewStart > 0 && travel > 0 ? (input.viewStartMs / maxViewStart) * travel : 0;
  return { thumbLeftPx, thumbWidthPx };
};

export const viewStartFromThumbDrag = (input: {
  originViewStartMs: number;
  deltaPx: number;
  trackWidthPx: number;
  originTotEndMs: number;
  viewportMs: number;
}): number => {
  const tot = Math.max(input.originTotEndMs, 1);
  const track = Math.max(input.trackWidthPx, 1);
  const thumbWidthPx = Math.min(
    track,
    Math.max(TIMELINE_H_SCROLL_MIN_THUMB_PX, (input.viewportMs / tot) * track),
  );
  const maxViewStart = Math.max(tot - input.viewportMs, 0);
  const travel = Math.max(track - thumbWidthPx, 0);
  if (travel <= 0 || maxViewStart <= 0) return clampViewStartMs(input.originViewStartMs);
  return clampViewStartMs(
    input.originViewStartMs + (input.deltaPx / travel) * maxViewStart,
  );
};

export const viewStartFromBarClick = (input: {
  clickXPx: number;
  trackWidthPx: number;
  totEndMs: number;
  viewportMs: number;
}): number => {
  const maxViewStart = Math.max(input.totEndMs - input.viewportMs, 0);
  const ratio = input.clickXPx / Math.max(input.trackWidthPx, 1);
  return clampViewStartMs(ratio * maxViewStart);
};