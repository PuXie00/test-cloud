// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { TIMELINE_PAD_LEFT, msToPx } from "./timeline-data";
import { edgeScrollStepPx, EDGE_SCROLL_ZONE_PX } from "./timeline-edge-scroll";
import { TimelineEditor } from "./timeline-editor";
import { collectTimeRangeBlockIds, columnBlockIds, columnTimesMs } from "./timeline-marquee";
import { createTimelineProps, installTimelinePaneWidth } from "./timeline-test-helpers";
import { TimelineToolbar } from "./timeline-toolbar";
import {
  pxPerSecondFromZoomSlider,
  viewStartForCursorZoom,
  zoomSliderValue,
  ZOOM_SLIDER_STEPS,
} from "./timeline-view-extent";

const pose = (id: string, objectId: number, atMs: number) =>
  ({ id, kind: "pose", objectId, atMs, pose: { v1: atMs / 10, v2: 0, v3: 0 } }) as const;

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: false,
  blocks: [pose("a0", 7, 0), pose("a2", 7, 2000), pose("a4", 7, 4000), pose("b2", 8, 2000), pose("b5", 8, 5000)],
  segments: [],
};

const mockRect = (element: Element, rect: { left: number; width: number; top?: number; height?: number }) => {
  const top = rect.top ?? 0;
  const height = rect.height ?? 120;
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: rect.left,
    y: top,
    left: rect.left,
    top,
    width: rect.width,
    height,
    right: rect.left + rect.width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect);
};

const playheadLeft = () => screen.getByTestId("timeline-playhead-line").style.left;

let restorePaneWidth: (() => void) | undefined;
beforeEach(() => {
  restorePaneWidth = installTimelinePaneWidth();
});
afterEach(() => {
  restorePaneWidth?.();
  vi.useRealTimers();
  cleanup();
});

describe("zoom around the playhead", () => {
  it("keeps the playhead where it is on screen when zooming", () => {
    const props = { ...createTimelineProps(sequence), cursorMs: 2000 };
    const { rerender } = render(<TimelineEditor {...props} />);
    expect(playheadLeft()).toBe(`${TIMELINE_PAD_LEFT + msToPx(2000, 100)}px`);
    rerender(<TimelineEditor {...props} timelinePxPerSecond={200} />);
    expect(playheadLeft()).toBe(`${TIMELINE_PAD_LEFT + msToPx(2000, 100)}px`);
    rerender(<TimelineEditor {...props} timelinePxPerSecond={50} />);
    // 往回缩时视图起点到 0 就停：游标回到按 50 px/s 的位置
    expect(playheadLeft()).toBe(`${TIMELINE_PAD_LEFT + msToPx(2000, 50)}px`);
  });

  it("puts an off-screen playhead in the middle after zooming", () => {
    const props = { ...createTimelineProps(sequence), cursorMs: 30_000 };
    const { rerender } = render(<TimelineEditor {...props} />);
    rerender(<TimelineEditor {...props} timelinePxPerSecond={50} />);
    // 800 px 宽、50 px/s：视野 15.84 s，游标放在中间
    expect(playheadLeft()).toBe(`${TIMELINE_PAD_LEFT + msToPx(7920, 50)}px`);
  });

  it("fits from zero without anchoring on the playhead", () => {
    const onTimelinePxPerSecondChange = vi.fn();
    const props = { ...createTimelineProps(sequence), cursorMs: 4000, onTimelinePxPerSecondChange };
    const { rerender } = render(<TimelineEditor {...props} />);
    rerender(<TimelineEditor {...props} fitRequestId={1} />);
    const fitted = onTimelinePxPerSecondChange.mock.calls[0]?.[0] as number;
    rerender(<TimelineEditor {...props} fitRequestId={1} timelinePxPerSecond={fitted} />);
    expect(playheadLeft()).toBe(`${TIMELINE_PAD_LEFT + msToPx(4000, fitted)}px`);
  });

  it("computes the anchored view start", () => {
    expect(
      viewStartForCursorZoom({
        cursorMs: 3000,
        viewStartMs: 1000,
        viewportWidthPx: 808,
        previousPxPerSecond: 100,
        nextPxPerSecond: 200,
      }),
    ).toBe(2000);
    expect(
      viewStartForCursorZoom({
        cursorMs: 20_000,
        viewStartMs: 0,
        viewportWidthPx: 808,
        previousPxPerSecond: 100,
        nextPxPerSecond: 100,
      }),
    ).toBe(16_000);
  });

  it("maps the slider on a log scale over the whole zoom range", () => {
    expect(zoomSliderValue(2)).toBe(0);
    expect(zoomSliderValue(200)).toBe(ZOOM_SLIDER_STEPS);
    expect(zoomSliderValue(20)).toBe(ZOOM_SLIDER_STEPS / 2);
    expect(pxPerSecondFromZoomSlider(ZOOM_SLIDER_STEPS / 2)).toBeCloseTo(20);
    expect(pxPerSecondFromZoomSlider(-5)).toBe(2);
  });
});

describe("timeline toolbar zoom", () => {
  it("zooms with a slider and − + instead of showing the tick seconds", () => {
    const onPxPerSecondChange = vi.fn();
    render(<TimelineToolbar canDelete pxPerSecond={20} onPxPerSecondChange={onPxPerSecondChange} />);
    expect(screen.queryByTitle("自适应主刻度（秒）")).toBeNull();
    const slider = screen.getByRole("slider", { name: "时间轴缩放" });
    expect((slider as HTMLInputElement).value).toBe(String(ZOOM_SLIDER_STEPS / 2));
    fireEvent.change(slider, { target: { value: String(ZOOM_SLIDER_STEPS) } });
    expect(onPxPerSecondChange).toHaveBeenLastCalledWith(200);
    fireEvent.click(screen.getByRole("button", { name: "放大时间轴" }));
    expect(onPxPerSecondChange).toHaveBeenLastCalledWith(25);
    fireEvent.click(screen.getByRole("button", { name: "缩小时间轴" }));
    expect(onPxPerSecondChange).toHaveBeenLastCalledWith(16);
  });
});

describe("edge auto-scroll", () => {
  it("scrolls faster the further the pointer goes past an edge", () => {
    const bounds = { left: 100, right: 900 };
    expect(edgeScrollStepPx(500, bounds)).toBe(0);
    expect(edgeScrollStepPx(900 - EDGE_SCROLL_ZONE_PX, bounds)).toBe(0);
    const near = edgeScrollStepPx(895, bounds);
    const far = edgeScrollStepPx(960, bounds);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
    expect(edgeScrollStepPx(90, bounds)).toBeLessThan(0);
  });

  it("scrolls the view while the playhead is dragged past the right edge", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    const onCursorChange = vi.fn();
    render(<TimelineEditor {...createTimelineProps(sequence)} onCursorChange={onCursorChange} snapEnabled={false} />);
    const scroll = screen.getByTestId("timeline-scroll");
    mockRect(scroll, { left: 0, width: 800 });
    const pose = screen.getByRole("button", { name: /位姿 a2/ });
    expect(pose.style.left).toBe(`${msToPx(2000, 100)}px`);
    fireEvent.pointerDown(screen.getByRole("slider", { name: "播放游标" }), { clientX: 200, button: 0 });
    fireEvent.pointerMove(window, { clientX: 900 });
    // 游标停在右边上
    expect(onCursorChange).toHaveBeenLastCalledWith(7900);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerUp(window);
    const shiftedPx = msToPx(2000, 100) - Number.parseFloat(pose.style.left);
    expect(shiftedPx).toBeGreaterThan(0);
    const lastCursor = onCursorChange.mock.calls.at(-1)?.[0] as number;
    expect(lastCursor).toBeGreaterThan(7900);
    // 松手后不再滚
    const leftAfterUp = pose.style.left;
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(pose.style.left).toBe(leftAfterUp);
  });

  it("keeps a dragged pose under the pointer while the view scrolls", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    const onPoseMove = vi.fn();
    render(<TimelineEditor {...createTimelineProps(sequence)} onPoseMove={onPoseMove} snapEnabled={false} />);
    mockRect(screen.getByTestId("timeline-scroll"), { left: 0, width: 800 });
    const pose = screen.getByRole("button", { name: /位姿 a4/ });
    fireEvent.pointerDown(pose, { clientX: 400, button: 0 });
    fireEvent.pointerMove(window, { clientX: 790 });
    expect(onPoseMove).toHaveBeenLastCalledWith("a4", 7900);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.pointerUp(window);
    expect(onPoseMove.mock.calls.at(-1)?.[1]).toBeGreaterThan(7900);
  });
});

describe("column selection", () => {
  it("lists the times that have poses and the poses at a time", () => {
    expect(columnTimesMs(sequence)).toEqual([0, 2000, 4000, 5000]);
    expect(columnBlockIds(sequence, 2000)).toEqual(["a2", "b2"]);
    expect(collectTimeRangeBlockIds(sequence, { startMs: 4500, endMs: 1500 })).toEqual(["a2", "a4", "b2"]);
  });

  it("selects a whole column from the ruler diamond and moves the playhead there", () => {
    const onSelectionChange = vi.fn();
    const onCursorChange = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence, onSelectionChange)}
        onCursorChange={onCursorChange}
      />,
    );
    const diamond = screen.getByRole("button", { name: "整列 2.0 s" });
    fireEvent.pointerDown(diamond, { clientX: 208, button: 0 });
    fireEvent.pointerUp(window);
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "multi-block", blockIds: ["a2", "b2"] }, "replace");
    expect(onCursorChange).toHaveBeenCalledWith(2000);
  });

  it("adds a column with Ctrl and highlights a fully selected column", () => {
    const onSelectionChange = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence, onSelectionChange)}
        selection={{ kind: "multi-block", blockIds: ["a2", "b2"] }}
      />,
    );
    expect(screen.getByRole("button", { name: "整列 2.0 s" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "整列 4.0 s" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.pointerDown(screen.getByRole("button", { name: "整列 4.0 s" }), {
      clientX: 408,
      button: 0,
      ctrlKey: true,
    });
    fireEvent.pointerUp(window);
    expect(onSelectionChange).toHaveBeenCalledWith(
      { kind: "multi-block", blockIds: ["a2", "b2", "a4"] },
      "add",
    );
  });

  it("drags a whole column by its diamond", () => {
    const onSelectionChange = vi.fn();
    const onBlocksShift = vi.fn();
    const onBlocksShiftEnd = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence, onSelectionChange)}
        onBlocksShift={onBlocksShift}
        onBlocksShiftEnd={onBlocksShiftEnd}
        snapEnabled={false}
      />,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "整列 2.0 s" }), { clientX: 208, button: 0 });
    fireEvent.pointerMove(window, { clientX: 258 });
    fireEvent.pointerUp(window);
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "multi-block", blockIds: ["a2", "b2"] }, "replace");
    expect(onBlocksShift).toHaveBeenLastCalledWith(["a2", "b2"], 500);
    expect(onBlocksShiftEnd).toHaveBeenCalled();
  });

  it("selects the column of a double-clicked pose", () => {
    const onSelectionChange = vi.fn();
    render(<TimelineEditor {...createTimelineProps(sequence, onSelectionChange)} />);
    fireEvent.doubleClick(screen.getByRole("button", { name: /位姿 b2/ }));
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: "multi-block", blockIds: ["a2", "b2"] }, "replace");
  });

  it("selects every object's blocks in a Shift-dragged ruler range", () => {
    const onSelectionChange = vi.fn();
    const onCursorChange = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence, onSelectionChange)}
        onCursorChange={onCursorChange}
      />,
    );
    const ruler = screen.getByRole("slider", { name: "时间标尺（秒）" });
    mockRect(ruler, { left: 0, width: 2000, height: 32 });
    fireEvent.pointerDown(ruler, { clientX: 150, button: 0, shiftKey: true });
    fireEvent.pointerMove(window, { clientX: 450 });
    expect(screen.getByTestId("timeline-ruler-range")).toBeTruthy();
    fireEvent.pointerUp(window);
    expect(onSelectionChange).toHaveBeenCalledWith(
      { kind: "multi-block", blockIds: ["a2", "a4", "b2"] },
      "replace",
    );
    expect(onCursorChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("timeline-ruler-range")).toBeNull();
  });
});

describe("scale handle", () => {
  it("frames two selected segments and scales them by dragging the right edge", () => {
    const onScaleSelection = vi.fn();
    const onScaleSelectionEnd = vi.fn();
    const props = {
      ...createTimelineProps(sequence),
      selection: { kind: "multi-block" as const, blockIds: ["a0", "a2", "a4", "b2", "b5"] },
      snapEnabled: false,
      onScaleSelection,
      onScaleSelectionEnd,
    };
    render(<TimelineEditor {...props} />);
    const frame = screen.getByTestId("timeline-scale-frame");
    expect(frame.style.left).toBe(`${TIMELINE_PAD_LEFT}px`);
    expect(frame.style.width).toBe(`${msToPx(5000, 100)}px`);
    const handle = screen.getByRole("slider", { name: "整体缩放选中的区间" });
    fireEvent.pointerDown(handle, { clientX: 508, button: 0 });
    fireEvent.pointerMove(window, { clientX: 608 });
    expect(onScaleSelection).toHaveBeenLastCalledWith(["a0", "a2", "a4", "b2", "b5"], 6000);
    expect(screen.getByTestId("timeline-scale-readout").textContent).toContain("5.0 s → 5.0 s");
    fireEvent.pointerUp(window);
    expect(onScaleSelectionEnd).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("timeline-scale-readout")).toBeNull();
  });

  it("has no frame for a single segment or without the scale handler", () => {
    const one = { kind: "multi-block" as const, blockIds: ["a0", "a2"] };
    const { rerender } = render(
      <TimelineEditor {...createTimelineProps(sequence)} selection={one} onScaleSelection={vi.fn()} />,
    );
    expect(screen.queryByTestId("timeline-scale-frame")).toBeNull();
    rerender(
      <TimelineEditor
        {...createTimelineProps(sequence)}
        selection={{ kind: "multi-block", blockIds: ["a0", "a2", "a4"] }}
      />,
    );
    expect(screen.queryByTestId("timeline-scale-frame")).toBeNull();
  });
});
