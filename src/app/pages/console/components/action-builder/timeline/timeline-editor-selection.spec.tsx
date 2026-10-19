// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { TIMELINE_PAD_LEFT } from "./timeline-data";
import { TimelineEditor } from "./timeline-editor";
import { createTimelineProps, installTimelinePaneWidth } from "./timeline-test-helpers";

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: false,
  blocks: [
    { id: "a1", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 1000, v2: 0, v3: 0 } },
    { id: "a2", kind: "pose", objectId: 7, atMs: 4000, pose: { v1: 2000, v2: 0, v3: 0 } },
    { id: "b1", kind: "pose", objectId: 8, atMs: 2000, pose: { v1: 0, v2: 0, v3: 0 } },
  ],
  segments: [],
};

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

let restorePaneWidth: (() => void) | undefined;
beforeEach(() => {
  restorePaneWidth = installTimelinePaneWidth();
});
afterEach(() => {
  restorePaneWidth?.();
  cleanup();
});

describe("timeline object list", () => {
  it("shows the shared object selection and reports clicks with the row order", () => {
    const onObjectClick = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence)}
        selectedObjectIds={[8]}
        onObjectClick={onObjectClick}
      />,
    );
    const row7 = screen.getByRole("button", { name: "模型 7" });
    const row8 = screen.getByRole("button", { name: "模型 8" });
    expect(row7.getAttribute("aria-pressed")).toBe("false");
    expect(row8.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(row7, { ctrlKey: true });
    expect(onObjectClick).toHaveBeenCalledWith(7, expect.objectContaining({ ctrlKey: true }), [7, 8]);
  });
});

describe("pointer on a motion segment", () => {
  const setup = (overrides: Partial<ReturnType<typeof createTimelineProps>> = {}) => {
    const onSelectionChange = vi.fn();
    const onCursorChange = vi.fn();
    const onBlocksShift = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence, onSelectionChange)}
        onCursorChange={onCursorChange}
        onBlocksShift={onBlocksShift}
        {...overrides}
      />,
    );
    const tracks = document.querySelector("[data-testid='timeline-tracks']") as HTMLElement;
    const scroll = document.querySelector("[data-testid='timeline-scroll']") as HTMLElement;
    mockRect(scroll, { left: 0, top: 0, width: 800, height: 120 });
    mockRect(tracks, { left: TIMELINE_PAD_LEFT, top: 32, width: 800, height: 200 });
    const band = screen.getByRole("button", { name: /运动区间 7/ });
    return { onSelectionChange, onCursorChange, onBlocksShift, band };
  };

  it("box-selects blocks with Shift+drag from a segment and ignores the trailing click", () => {
    const { onSelectionChange, onCursorChange, onBlocksShift, band } = setup();
    fireEvent.pointerDown(band, {
      clientX: TIMELINE_PAD_LEFT + 250,
      clientY: 40,
      button: 0,
      shiftKey: true,
    });
    fireEvent.pointerMove(window, { clientX: TIMELINE_PAD_LEFT + 450, clientY: 80 });
    fireEvent.pointerUp(window, { clientX: TIMELINE_PAD_LEFT + 450, clientY: 80 });
    fireEvent.click(band);

    expect(onCursorChange).not.toHaveBeenCalled();
    expect(onBlocksShift).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "block", blockId: "a2" });
  });

  it("selects both end poses on a plain click without moving the playhead", () => {
    const { onSelectionChange, onCursorChange, band } = setup();
    fireEvent.pointerDown(band, { clientX: TIMELINE_PAD_LEFT + 300, clientY: 40, button: 0 });
    fireEvent.pointerUp(window, { clientX: TIMELINE_PAD_LEFT + 300, clientY: 40 });
    fireEvent.click(band);

    expect(onCursorChange).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith({
      kind: "multi-block",
      blockIds: ["a1", "a2"],
      focus: "segments",
    });
  });

  it("drags both end poses of an unselected segment and keeps them selected afterwards", () => {
    const { onSelectionChange, onBlocksShift, band } = setup({
      selection: { kind: "block", blockId: "b1" },
    });
    fireEvent.pointerDown(band, { clientX: 300, clientY: 40, button: 0 });
    fireEvent.pointerMove(window, { clientX: 350, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 350, clientY: 40 });
    fireEvent.click(band);

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith({
      kind: "multi-block",
      blockIds: ["a1", "a2"],
      focus: "segments",
    });
    expect(onBlocksShift).toHaveBeenLastCalledWith(["a1", "a2"], 500);
  });

  it("drags the whole selection when the segment is part of it", () => {
    const { onSelectionChange, onBlocksShift, band } = setup({
      selection: { kind: "multi-block", blockIds: ["a1", "a2", "b1"] },
    });
    expect(band.getAttribute("aria-pressed")).toBe("true");
    fireEvent.pointerDown(band, { clientX: 300, clientY: 40, button: 0 });
    fireEvent.pointerMove(window, { clientX: 250, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 250, clientY: 40 });

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onBlocksShift).toHaveBeenLastCalledWith(["a1", "a2", "b1"], -500);
  });

  it("snaps whichever end of the dragged segment is closer", () => {
    const { onBlocksShift, band } = setup({ selection: { kind: "block", blockId: "a1" } });
    // 97 px = 0.97 s：起点到 2.97 s、终点到 4.97 s，都在整秒 4 px 内 → 起点吸到 3.0 s
    fireEvent.pointerDown(band, { clientX: 300, clientY: 40, button: 0 });
    fireEvent.pointerMove(window, { clientX: 397, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 397, clientY: 40 });
    expect(onBlocksShift).toHaveBeenLastCalledWith(["a1", "a2"], 1000);
  });

  it("snaps the end of the dragged segment when it is the closer one", () => {
    const withTarget: ActionSequenceConfig = {
      ...sequence,
      blocks: [
        ...sequence.blocks,
        { id: "b2", kind: "pose", objectId: 8, atMs: 6050, pose: { v1: 0, v2: 0, v3: 0 } },
      ],
    };
    const onBlocksShift = vi.fn();
    render(<TimelineEditor {...createTimelineProps(withTarget)} onBlocksShift={onBlocksShift} />);
    const band = screen.getByRole("button", { name: /运动区间 7/ });
    // 203 px：起点 4.03 s 离整秒 30 ms，终点 6.03 s 离 b2 只有 20 ms → 终点吸到 6.05 s
    fireEvent.pointerDown(band, { clientX: 300, clientY: 40, button: 0 });
    fireEvent.pointerMove(window, { clientX: 503, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 503, clientY: 40 });
    expect(onBlocksShift).toHaveBeenLastCalledWith(["a1", "a2"], 2050);
  });

  it("adds and removes a segment with Ctrl/⌘+click", () => {
    const { onSelectionChange, band } = setup({ selection: { kind: "block", blockId: "b1" } });
    fireEvent.click(band, { ctrlKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      kind: "multi-block",
      blockIds: ["b1", "a1", "a2"],
      focus: "segments",
    });
    cleanup();

    const second = setup({ selection: { kind: "multi-block", blockIds: ["a1", "a2", "b1"] } });
    fireEvent.click(second.band, { metaKey: true });
    expect(second.onSelectionChange).toHaveBeenLastCalledWith({ kind: "block", blockId: "b1" });
  });
});

describe("pointer on a block", () => {
  it("adds and removes a pose with Ctrl/⌘+click", () => {
    const onSelectionChange = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence, onSelectionChange)}
        selection={{ kind: "block", blockId: "a1" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /位姿 b1/ }), { ctrlKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      kind: "multi-block",
      blockIds: ["a1", "b1"],
    });
    fireEvent.click(screen.getByRole("button", { name: /位姿 a1/ }), { ctrlKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps a group selected after dragging one of its poses", () => {
    const onSelectionChange = vi.fn();
    const onBlocksShift = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence, onSelectionChange)}
        selection={{ kind: "multi-block", blockIds: ["a1", "b1"] }}
        onBlocksShift={onBlocksShift}
      />,
    );
    const pose = screen.getByRole("button", { name: /位姿 a1/ });
    fireEvent.pointerDown(pose, { clientX: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 150 });
    fireEvent.pointerUp(window);
    fireEvent.click(pose);
    expect(onBlocksShift).toHaveBeenCalledWith(["a1", "b1"], 500);
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("selects an unselected pose when dragging it", () => {
    const onSelectionChange = vi.fn();
    const onPoseMove = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence, onSelectionChange)}
        selection={{ kind: "block", blockId: "b1" }}
        onPoseMove={onPoseMove}
      />,
    );
    const pose = screen.getByRole("button", { name: /位姿 a2/ });
    fireEvent.pointerDown(pose, { clientX: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 150 });
    fireEvent.pointerMove(window, { clientX: 160 });
    fireEvent.pointerUp(window);
    fireEvent.click(pose);
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "block", blockId: "a2" });
    expect(onPoseMove).toHaveBeenLastCalledWith("a2", 4600);
  });

  it("treats a press that barely moves as a click", () => {
    const onSelectionChange = vi.fn();
    const onPoseMove = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence, onSelectionChange)}
        onPoseMove={onPoseMove}
      />,
    );
    const pose = screen.getByRole("button", { name: /位姿 a2/ });
    fireEvent.pointerDown(pose, { clientX: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 102 });
    fireEvent.pointerUp(window);
    fireEvent.click(pose, { ctrlKey: true });
    expect(onPoseMove).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "block", blockId: "a2" });
  });
});
