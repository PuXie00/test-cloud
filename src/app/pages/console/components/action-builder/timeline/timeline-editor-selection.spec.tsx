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

describe("marquee from a motion segment", () => {
  const setup = () => {
    const onSelectionChange = vi.fn();
    const onCursorChange = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence, onSelectionChange)}
        onCursorChange={onCursorChange}
      />,
    );
    const tracks = document.querySelector("[data-testid='timeline-tracks']") as HTMLElement;
    const scroll = document.querySelector("[data-testid='timeline-scroll']") as HTMLElement;
    mockRect(scroll, { left: 0, top: 0, width: 800, height: 120 });
    mockRect(tracks, { left: TIMELINE_PAD_LEFT, top: 32, width: 800, height: 200 });
    const band = screen.getByRole("button", { name: /运动区间 7/ });
    return { onSelectionChange, onCursorChange, band };
  };

  it("box-selects blocks when the drag starts on a segment and ignores the trailing click", () => {
    const { onSelectionChange, onCursorChange, band } = setup();
    fireEvent.pointerDown(band, { clientX: TIMELINE_PAD_LEFT + 250, clientY: 40, button: 0 });
    fireEvent.pointerMove(window, { clientX: TIMELINE_PAD_LEFT + 450, clientY: 80 });
    fireEvent.pointerUp(window, { clientX: TIMELINE_PAD_LEFT + 450, clientY: 80 });
    fireEvent.click(band);

    expect(onCursorChange).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "block", blockId: "a2" });
  });

  it("still selects the segment on a plain click without moving the playhead", () => {
    const { onSelectionChange, onCursorChange, band } = setup();
    fireEvent.pointerDown(band, { clientX: TIMELINE_PAD_LEFT + 300, clientY: 40, button: 0 });
    fireEvent.pointerUp(window, { clientX: TIMELINE_PAD_LEFT + 300, clientY: 40 });
    fireEvent.click(band);

    expect(onCursorChange).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith({
      kind: "segment",
      objectId: 7,
      fromRef: "a1",
      toRef: "a2",
    });
  });
});
