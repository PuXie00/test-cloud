import { describe, expect, it } from "vitest";
import {
  TIMELINE_H_SCROLL_MIN_THUMB_PX,
  canvasWidthPx,
  clampCursorMs,
  clampViewStartMs,
  hScrollThumbLayout,
  panViewStartMs,
  totEndMs,
  usedBandWidthPx,
  usedBandScreenRect,
  viewPxFromMs,
  viewStartForZoomAnchor,
  viewStartFromBarClick,
  viewStartFromThumbDrag,
  viewWindowEndMs,
  viewportDurationMs,
  followPlayheadViewStart,
} from "./timeline-view-extent";
import { TIMELINE_PAD_LEFT, msToPx } from "./timeline-data";

describe("timeline view extent", () => {
  it("converts the timed pane width (minus left pad) to milliseconds", () => {
    expect(viewportDurationMs(TIMELINE_PAD_LEFT + 200, 100)).toBe(2000);
  });

  it("gives the used band no width when the sequence is empty", () => {
    expect(usedBandWidthPx(0, 100)).toBe(0);
    expect(usedBandWidthPx(1500, 100)).toBe(msToPx(1500, 100));
  });

  it("does not clamp the playhead to occupied time", () => {
    expect(clampCursorMs(-10)).toBe(0);
    expect(clampCursorMs(12_000)).toBe(12_000);
    expect(clampCursorMs(847)).toBe(800);
    expect(clampCursorMs(850)).toBe(900);
    expect(clampCursorMs(851)).toBe(900);
  });
});

describe("View2D window", () => {
  it("viewWindowEndMs is viewStart plus viewport", () => {
    expect(viewWindowEndMs(2000, 4000)).toBe(6000);
  });

  it("pans viewStart only when the playhead leaves the window", () => {
    expect(followPlayheadViewStart({ cursorMs: 500, viewStartMs: 0, viewportMs: 2000 })).toBe(0);
    expect(followPlayheadViewStart({ cursorMs: 2000, viewStartMs: 0, viewportMs: 2000 })).toBe(1);
    expect(followPlayheadViewStart({ cursorMs: 2500, viewStartMs: 0, viewportMs: 2000 })).toBe(501);
    expect(followPlayheadViewStart({ cursorMs: 100, viewStartMs: 500, viewportMs: 2000 })).toBe(100);
    expect(followPlayheadViewStart({ cursorMs: 100, viewStartMs: 0, viewportMs: 0 })).toBe(0);
  });

  it("totEndMs is max of occupied, view end, and one viewport", () => {
    expect(totEndMs(4000, 8000, 8000)).toBe(8000);
    expect(totEndMs(4000, 12000, 8000)).toBe(12000);
    expect(totEndMs(20000, 8000, 8000)).toBe(20000);
  });

  it("clamps viewStart to >= 0 and pans by pixel delta", () => {
    expect(clampViewStartMs(-12.2)).toBe(0);
    expect(panViewStartMs(0, 40, 100)).toBe(0);
    expect(panViewStartMs(0, -40, 100)).toBe(400);
  });

  it("grows tot when the window moves right of occupied time", () => {
    const start = panViewStartMs(0, -40, 100);
    const viewport = 8000;
    expect(totEndMs(4000, viewWindowEndMs(start, viewport), viewport)).toBe(8400);
  });

  it("keeps canvas width independent of viewStart", () => {
    expect(canvasWidthPx(800)).toBe(800);
    expect(canvasWidthPx(800)).toBe(canvasWidthPx(800));
  });

  it("maps absolute time into the pane relative to viewStart", () => {
    expect(viewPxFromMs(1000, 0, 100)).toBe(msToPx(1000, 100));
    expect(viewPxFromMs(1000, 400, 100)).toBe(msToPx(600, 100));
  });

  it("fills the t=0 pad on the used band and shifts when viewStart > 0", () => {
    expect(usedBandScreenRect(0, 0, 100)).toBeNull();
    expect(usedBandScreenRect(4000, 0, 100)).toEqual({
      leftPx: 0,
      widthPx: TIMELINE_PAD_LEFT + msToPx(4000, 100),
    });
    expect(usedBandScreenRect(4000, 1000, 100)).toEqual({
      leftPx: TIMELINE_PAD_LEFT + msToPx(-1000, 100),
      widthPx: msToPx(4000, 100),
    });
  });

  it("keeps the zoom anchor under the pointer and clamps viewStart", () => {
    expect(
      viewStartForZoomAnchor({
        anchorMs: 3000,
        pointerXFromPad: 200,
        nextPxPerSecond: 50,
      }),
    ).toBe(0);
    expect(
      viewStartForZoomAnchor({
        anchorMs: 5000,
        pointerXFromPad: 200,
        nextPxPerSecond: 100,
      }),
    ).toBe(3000);
  });

  it("lays out the H-bar thumb from cur/tot and maps drag/click back to viewStart", () => {
    const layout = hScrollThumbLayout({
      viewStartMs: 0,
      viewportMs: 8000,
      totEndMs: 16000,
      trackWidthPx: 200,
    });
    expect(layout.thumbWidthPx).toBe(100);
    expect(layout.thumbLeftPx).toBe(0);
    expect(
      hScrollThumbLayout({
        viewStartMs: 0,
        viewportMs: 8000,
        totEndMs: 8000,
        trackWidthPx: 200,
      }).thumbWidthPx,
    ).toBe(200);
    expect(
      hScrollThumbLayout({
        viewStartMs: 0,
        viewportMs: 100,
        totEndMs: 10_000,
        trackWidthPx: 200,
      }).thumbWidthPx,
    ).toBe(TIMELINE_H_SCROLL_MIN_THUMB_PX);
    expect(
      viewStartFromThumbDrag({
        originViewStartMs: 0,
        deltaPx: 50,
        trackWidthPx: 200,
        originTotEndMs: 16000,
        viewportMs: 8000,
      }),
    ).toBe(4000);
    expect(
      viewStartFromBarClick({
        clickXPx: 100,
        trackWidthPx: 200,
        totEndMs: 16000,
        viewportMs: 8000,
      }),
    ).toBe(4000);
  });

  it("maps thumb layout and drag inversely when the min thumb applies", () => {
    const viewportMs = 100;
    const totEndMs = 10_000;
    const trackWidthPx = 200;
    const viewStartMs = 5000;
    const layout = hScrollThumbLayout({
      viewStartMs,
      viewportMs,
      totEndMs,
      trackWidthPx,
    });
    expect(layout.thumbWidthPx).toBe(TIMELINE_H_SCROLL_MIN_THUMB_PX);
    const travel = trackWidthPx - layout.thumbWidthPx;
    expect(layout.thumbLeftPx).toBeCloseTo((viewStartMs / (totEndMs - viewportMs)) * travel, 5);
    expect(
      viewStartFromThumbDrag({
        originViewStartMs: 0,
        deltaPx: layout.thumbLeftPx,
        trackWidthPx,
        originTotEndMs: totEndMs,
        viewportMs,
      }),
    ).toBe(viewStartMs);
  });
});
