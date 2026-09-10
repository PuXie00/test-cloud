// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { TIMELINE_PAD_LEFT, msToPx } from "./timeline-data";
import { TimelineEditor } from "./timeline-editor";
import { createTimelineProps, installTimelinePaneWidth } from "./timeline-test-helpers";

const sequence: ActionSequenceConfig = {
  id: "seq",
  name: "Seq",
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: "first",
      kind: "pose",
      objectId: 7,
      atMs: 2000,
      pose: { v1: 1000, v2: 10, v3: 0 },
    },
    {
      id: "later",
      kind: "pose",
      objectId: 7,
      atMs: 4000,
      pose: { v1: 2000, v2: 0, v3: 0 },
    },
  ],
  segments: [],
};

let restorePaneWidth: (() => void) | undefined;
beforeEach(() => {
  restorePaneWidth = installTimelinePaneWidth();
});
afterEach(() => {
  restorePaneWidth?.();
  cleanup();
});

describe("sequence track", () => {
  it("marks the earliest authored pose at its real time and hides the fixed column", () => {
    render(<TimelineEditor {...createTimelineProps(sequence)} />);
    expect(screen.queryByText("起始")).toBeNull();
    expect(screen.getByLabelText(/位姿 first/).textContent).toContain("起");
    expect(screen.getByLabelText(/位姿 later/).textContent).not.toContain("起");
    expect(document.querySelector("[data-fixed-track-column]")).toBeNull();
  });

  it("selects a derived segment independently from endpoint poses", () => {
    const handleSelect = vi.fn();
    render(<TimelineEditor {...createTimelineProps(sequence, handleSelect)} />);
    fireEvent.click(screen.getByRole("button", { name: /运动区间.*7/ }));
    expect(handleSelect).toHaveBeenCalledWith({
      kind: "segment",
      objectId: 7,
      fromRef: "first",
      toRef: "later",
    });
  });

  it("positions a pose marker only from atMs", () => {
    render(<TimelineEditor {...createTimelineProps(sequence)} />);
    const pose = screen.getByRole("button", { name: /位姿 first/ });
    expect(pose.getAttribute("data-timeline-time")).toBe("2000");
    expect(pose.style.left).toBe(`${msToPx(2000, 100)}px`);
    expect(pose.style.width).toBe("");
  });

  it("aligns the pose diamond center to t, not the whole chip", () => {
    render(<TimelineEditor {...createTimelineProps(sequence)} />);
    const pose = screen.getByRole("button", { name: /位姿 first/ });
    const glyph = pose.querySelector("[aria-hidden]") as HTMLElement;
    expect(pose.className.split(/\s+/)).not.toContain("-translate-x-1/2");
    expect(glyph).not.toBeNull();
    expect(glyph.className.split(/\s+/)).toContain("-translate-x-1/2");
  });

  it("renders a shorter motion band with quiet fill and primary selection", () => {
    const { rerender } = render(<TimelineEditor {...createTimelineProps(sequence)} />);
    const idle = screen.getByRole("button", { name: /运动区间.*7/ });
    expect(idle.className.split(/\s+/)).toContain("h-5");
    expect(idle.className.split(/\s+/)).toContain("bg-secondary/15");
    rerender(
      <TimelineEditor
        {...createTimelineProps(sequence)}
        selection={{ kind: "segment", objectId: 7, fromRef: "first", toRef: "later" }}
      />,
    );
    const selected = screen.getByRole("button", { name: /运动区间.*7/ });
    expect(selected.className.split(/\s+/)).toContain("h-5");
    expect(selected.className.split(/\s+/)).toContain("bg-primary/20");
    expect(selected.className.split(/\s+/)).toContain("border-l-primary");
  });

  it("paints an invalid motion segment with warning fill, not destructive", () => {
    render(
      <TimelineEditor
        {...createTimelineProps(sequence)}
        invalidTargets={{
          blockIds: new Set(),
          segmentKeys: new Set(["first->later"]),
          blockMessage: new Map(),
          segmentMessage: new Map([["first->later", "axis v1 acceleration exceeds"]]),
        }}
      />,
    );
    const band = screen.getByRole("button", { name: /运动区间.*7/ });
    expect(band.getAttribute("data-invalid")).toBe("true");
    expect(band.className.split(/\s+/)).toContain("bg-warning/20");
    expect(band.className.split(/\s+/)).not.toContain("bg-destructive/20");
  });

  it("keeps primary left border when an invalid segment is selected", () => {
    render(
      <TimelineEditor
        {...createTimelineProps(sequence)}
        selection={{ kind: "segment", objectId: 7, fromRef: "first", toRef: "later" }}
        invalidTargets={{
          blockIds: new Set(),
          segmentKeys: new Set(["first->later"]),
          blockMessage: new Map(),
          segmentMessage: new Map(),
        }}
      />,
    );
    const selected = screen.getByRole("button", { name: /运动区间.*7/ });
    expect(selected.className.split(/\s+/)).toContain("bg-warning/20");
    expect(selected.className.split(/\s+/)).toContain("border-l-primary");
  });

  it("paints an invalid pose with warning background", () => {
    render(
      <TimelineEditor
        {...createTimelineProps(sequence)}
        invalidTargets={{
          blockIds: new Set(["first"]),
          segmentKeys: new Set(),
          blockMessage: new Map([["first", "axis v1 position outside"]]),
          segmentMessage: new Map(),
        }}
      />,
    );
    const pose = screen.getByRole("button", { name: /位姿 first/ });
    expect(pose.getAttribute("data-invalid")).toBe("true");
    expect(pose.className.split(/\s+/)).toContain("bg-warning/20");
  });

  it("selects a pose keyframe as a block", () => {
    const handleSelect = vi.fn();
    render(<TimelineEditor {...createTimelineProps(sequence, handleSelect)} />);
    fireEvent.click(screen.getByRole("button", { name: /位姿 first/ }));
    expect(handleSelect).toHaveBeenCalledWith({ kind: "block", blockId: "first" });
  });

  it("dragging a pose calls onPoseMove", () => {
    const onPoseMove = vi.fn();
    render(<TimelineEditor {...createTimelineProps(sequence)} onPoseMove={onPoseMove} />);
    const pose = screen.getByRole("button", { name: /位姿 first/ });
    fireEvent.pointerDown(pose, { clientX: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 150 });
    fireEvent.pointerUp(window);
    expect(onPoseMove).toHaveBeenCalledWith("first", 2500);
  });

  it("middle-click on a pose does not call onPoseMove", () => {
    const onPoseMove = vi.fn();
    render(<TimelineEditor {...createTimelineProps(sequence)} onPoseMove={onPoseMove} />);
    const pose = screen.getByRole("button", { name: /位姿 first/ });
    const scroll = document.querySelector("[data-testid='timeline-scroll']") as HTMLElement;
    mockRect(scroll, { left: 0, top: 0, width: 800, height: 120 });
    fireEvent.pointerDown(pose, { clientX: 100, button: 1 });
    fireEvent.pointerMove(window, { clientX: 50, button: 1 });
    fireEvent.pointerUp(window, { button: 1 });
    expect(onPoseMove).not.toHaveBeenCalled();
  });

  it("does not resize or drag a derived segment", () => {
    const onPoseMove = vi.fn();
    const onPresetMove = vi.fn();
    const onDynamicPresetResize = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence)}
        onPoseMove={onPoseMove}
        onPresetMove={onPresetMove}
        onDynamicPresetResize={onDynamicPresetResize}
      />,
    );
    const segment = screen.getByRole("button", { name: /运动区间.*7/ });
    expect(segment.querySelector("[data-resize]")).toBeNull();
    fireEvent.pointerDown(segment, { clientX: 40 });
    fireEvent.pointerMove(window, { clientX: 120 });
    fireEvent.pointerUp(window);
    expect(onPoseMove).not.toHaveBeenCalled();
    expect(onPresetMove).not.toHaveBeenCalled();
    expect(onDynamicPresetResize).not.toHaveBeenCalled();
  });

  it("places the playhead at the time-pane pad, not the label column", () => {
    const { rerender } = render(<TimelineEditor {...createTimelineProps(sequence)} cursorMs={0} />);
    const playhead = screen.getByRole("slider", { name: "播放游标" });
    expect(playhead.style.left).toBe(`${TIMELINE_PAD_LEFT}px`);
    rerender(<TimelineEditor {...createTimelineProps(sequence)} cursorMs={1000} />);
    expect(screen.getByRole("slider", { name: "播放游标" }).style.left).toBe(
      `${TIMELINE_PAD_LEFT + msToPx(1000, 100)}px`,
    );
    expect(screen.queryByText("起始")).toBeNull();
  });

  it("keeps the playhead head and shaft on one centered line", () => {
    render(<TimelineEditor {...createTimelineProps(sequence)} cursorMs={1000} />);
    const x = `${TIMELINE_PAD_LEFT + msToPx(1000, 100)}px`;
    const head = document.querySelector("[data-testid='timeline-playhead-head']") as HTMLElement;
    const shaft = document.querySelector("[data-testid='timeline-playhead-line']") as HTMLElement;
    expect(head).not.toBeNull();
    expect(shaft).not.toBeNull();
    expect(head.style.left).toBe(x);
    expect(shaft.style.left).toBe(x);
    expect(head.className).toContain("-translate-x-1/2");
    expect(shaft.className).toContain("-translate-x-1/2");
    expect(shaft.className).toContain("top-0");
    expect(shaft.className).toContain("bottom-0");
  });

  it("keeps object names outside the time scroll pane", () => {
    render(<TimelineEditor {...createTimelineProps(sequence)} />);
    const labels = document.querySelector("[data-testid='timeline-labels']") as HTMLElement;
    const scroll = document.querySelector("[data-testid='timeline-scroll']") as HTMLElement;
    expect(labels).not.toBeNull();
    expect(scroll).not.toBeNull();
    expect(labels.textContent).toContain("模型 7");
    expect(labels.querySelector("[data-block-id]")).toBeNull();
    expect(scroll.textContent).not.toContain("模型 7");
    expect(scroll.querySelector("[data-block-id]")).not.toBeNull();
    expect(scroll.querySelector("[data-testid='timeline-zero-tick']")).not.toBeNull();
  });

  it("centers ruler ticks and track grid lines on the same time origin", () => {
    render(<TimelineEditor {...createTimelineProps(sequence)} />);
    const atMs = 1000;
    const rulerTick = document.querySelector(`[data-testid='timeline-ruler-tick'][data-tick-ms='${atMs}']`) as HTMLElement;
    const gridLine = document.querySelector(`[data-testid='timeline-grid-line'][data-tick-ms='${atMs}']`) as HTMLElement;
    expect(rulerTick).not.toBeNull();
    expect(gridLine).not.toBeNull();
    expect(rulerTick.style.left).toBe(`${msToPx(atMs, 100)}px`);
    expect(rulerTick.className.split(/\s+/)).toContain("w-0");
    expect(gridLine.style.left).toBe(`${TIMELINE_PAD_LEFT + msToPx(atMs, 100)}px`);
    expect(gridLine.className.split(/\s+/)).toContain("-translate-x-1/2");
  });
});

const mockRect = (element: Element, rect: { left: number; top: number; width: number; height: number }) => {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON() {
      return {};
    },
  } as DOMRect);
};

describe("timeline interaction", () => {
  it("allows the playhead past occupied time from the ruler", () => {
    const onCursorChange = vi.fn();
    render(<TimelineEditor {...createTimelineProps(sequence)} onCursorChange={onCursorChange} />);
    const ruler = screen.getByRole("slider", { name: "时间标尺（秒）" });
    mockRect(ruler, { left: 0, top: 0, width: 2000, height: 32 });
    fireEvent.pointerDown(ruler, { clientX: 600 });
    expect(onCursorChange).toHaveBeenCalledWith(6000);
  });

  it("allows scrubbing an empty sequence", () => {
    const empty: ActionSequenceConfig = {
      id: "empty",
      name: "Empty",
      trajectoryMode: "non-forced",
      blocks: [],
      segments: [],
    };
    const onCursorChange = vi.fn();
    render(<TimelineEditor {...createTimelineProps(empty)} onCursorChange={onCursorChange} />);
    const ruler = screen.getByRole("slider", { name: "时间标尺（秒）" });
    mockRect(ruler, { left: 0, top: 0, width: 2000, height: 32 });
    fireEvent.pointerDown(ruler, { clientX: 200 });
    expect(onCursorChange).toHaveBeenCalledWith(2000);
  });

  it("sizes the used band to occupied time and omits it when empty", () => {
    const { unmount } = render(<TimelineEditor {...createTimelineProps(sequence)} />);
    const used = document.querySelector("[data-timeline-used-band]") as HTMLElement | null;
    expect(used).not.toBeNull();
    expect(used!.style.left).toBe("0px");
    expect(used!.style.width).toBe(`${TIMELINE_PAD_LEFT + msToPx(4000, 100)}px`);
    unmount();
    const empty: ActionSequenceConfig = {
      id: "empty",
      name: "Empty",
      trajectoryMode: "non-forced",
      blocks: [],
      segments: [],
    };
    render(<TimelineEditor {...createTimelineProps(empty)} />);
    expect(document.querySelector("[data-timeline-used-band]")).toBeNull();
    const unused = document.querySelector("[data-timeline-unused-band]") as HTMLElement | null;
    expect(unused).not.toBeNull();
    expect(unused!.style.left).toBe("0px");
  });

  it("clicking empty track moves the playhead and clears selection; dragging boxes blocks", () => {
    const onCursorChange = vi.fn();
    const onSelectionChange = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence, onSelectionChange)}
        cursorMs={0}
        onCursorChange={onCursorChange}
      />,
    );
    const tracks = document.querySelector("[data-testid='timeline-tracks']") as HTMLElement;
    const scroll = document.querySelector("[data-testid='timeline-scroll']") as HTMLElement;
    expect(tracks).not.toBeNull();
    mockRect(scroll, { left: 0, top: 0, width: 800, height: 120 });
    mockRect(tracks, { left: TIMELINE_PAD_LEFT, top: 32, width: 800, height: 36 });

    fireEvent.pointerDown(tracks, { clientX: TIMELINE_PAD_LEFT + 80, clientY: 40, button: 0 });
    fireEvent.pointerUp(window, { clientX: TIMELINE_PAD_LEFT + 80, clientY: 40, button: 0 });
    expect(onCursorChange).toHaveBeenCalledWith(800);
    expect(onSelectionChange).toHaveBeenCalledWith(null);

    onCursorChange.mockClear();
    onSelectionChange.mockClear();
    fireEvent.pointerDown(tracks, { clientX: TIMELINE_PAD_LEFT + 150, clientY: 40, button: 0 });
    fireEvent.pointerMove(window, { clientX: TIMELINE_PAD_LEFT + 450, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: TIMELINE_PAD_LEFT + 450, clientY: 40 });
    expect(onCursorChange).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledWith({
      kind: "multi-block",
      blockIds: ["first", "later"],
    });
  });

  it("presses every block in a multi-block selection", () => {
    render(
      <TimelineEditor
        {...createTimelineProps(sequence)}
        selection={{ kind: "multi-block", blockIds: ["first", "later"] }}
      />,
    );
    expect(screen.getByRole("button", { name: /位姿 first/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /位姿 later/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shifts the whole multi-selection when dragging one selected pose", () => {
    const onBlocksShift = vi.fn();
    const onPoseMove = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence)}
        selection={{ kind: "multi-block", blockIds: ["first", "later"] }}
        onBlocksShift={onBlocksShift}
        onPoseMove={onPoseMove}
      />,
    );
    const pose = screen.getByRole("button", { name: /位姿 first/ });
    fireEvent.pointerDown(pose, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 150 });
    fireEvent.pointerUp(window);
    expect(onBlocksShift).toHaveBeenCalledWith(["first", "later"], 500);
    expect(onPoseMove).not.toHaveBeenCalled();
  });

  it("zooms with the wheel without Ctrl, anchored at the pointer", () => {
    const onTimelinePxPerSecondChange = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence)}
        onTimelinePxPerSecondChange={onTimelinePxPerSecondChange}
      />,
    );
    const scroll = document.querySelector("[data-testid='timeline-scroll']") as HTMLElement;
    mockRect(scroll, { left: 0, top: 0, width: 800, height: 120 });
    fireEvent.wheel(scroll, { deltaY: -100, clientX: 300, ctrlKey: false });
    expect(onTimelinePxPerSecondChange).toHaveBeenCalled();
  });

  it("binds wheel zoom as a non-passive listener so preventDefault can run", () => {
    const add = vi.spyOn(HTMLElement.prototype, "addEventListener");
    render(<TimelineEditor {...createTimelineProps(sequence)} />);
    const nonPassiveWheel = add.mock.calls.some(
      ([type, , options]) =>
        type === "wheel" &&
        typeof options === "object" &&
        options !== null &&
        (options as AddEventListenerOptions).passive === false,
    );
    expect(nonPassiveWheel).toBe(true);
    add.mockRestore();
  });

  it("pans viewStart with middle-mouse drag without growing the canvas", () => {
    render(<TimelineEditor {...createTimelineProps(sequence)} />);
    const scroll = document.querySelector("[data-testid='timeline-scroll']") as HTMLElement;
    const canvas = document.querySelector("[data-testid='timeline-canvas']") as HTMLElement;
    const pose = screen.getByRole("button", { name: /位姿 first/ });
    const widthBefore = canvas.style.width;
    expect(pose.style.left).toBe(`${msToPx(2000, 100)}px`);
    fireEvent.pointerDown(scroll, { button: 1, clientX: 200, clientY: 40 });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 40 });
    fireEvent.pointerUp(window, { button: 1 });
    expect(pose.style.left).toBe(`${msToPx(1600, 100)}px`);
    expect(canvas.style.width).toBe(widthBefore);
    expect(scroll.className.split(/\s+/)).toContain("overflow-x-clip");
  });

  it("drags the H-bar to move the view", () => {
    render(<TimelineEditor {...createTimelineProps(sequence)} />);
    const scroll = document.querySelector("[data-testid='timeline-scroll']") as HTMLElement;
    mockRect(scroll, { left: 0, top: 0, width: 800, height: 120 });
    fireEvent.pointerDown(scroll, { button: 1, clientX: 200, clientY: 40 });
    fireEvent.pointerMove(window, { clientX: 120, clientY: 40 });
    fireEvent.pointerUp(window, { button: 1 });
    const pose = screen.getByRole("button", { name: /位姿 first/ });
    const leftBefore = pose.style.left;
    const track = document.querySelector("[data-testid='timeline-h-scroll']") as HTMLElement;
    const thumb = track.querySelector("[data-testid='timeline-h-scroll-thumb']") as HTMLElement;
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 200 });
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 200,
      height: 8,
      right: 200,
      bottom: 8,
      toJSON() {
        return {};
      },
    } as DOMRect);
    fireEvent.pointerDown(thumb, { clientX: 10, button: 0 });
    fireEvent.pointerMove(window, { clientX: 60 });
    fireEvent.pointerUp(window);
    expect(pose.style.left).not.toBe(leftBefore);
  });

  it("does not clamp ruler keyboard steps to occupied time", () => {
    const onCursorChange = vi.fn();
    render(
      <TimelineEditor {...createTimelineProps(sequence)} cursorMs={4000} onCursorChange={onCursorChange} />,
    );
    const ruler = screen.getByRole("slider", { name: "时间标尺（秒）" });
    fireEvent.keyDown(ruler, { key: "ArrowRight" });
    expect(onCursorChange).toHaveBeenCalledWith(5000);
  });
});
