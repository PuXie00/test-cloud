// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { TimelineEditor } from "./timeline-editor";
import { createTimelineProps, installTimelinePaneWidth } from "./timeline-test-helpers";

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: false,
  blocks: [
    { id: "a1", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 0 } },
    { id: "a2", kind: "pose", objectId: 7, atMs: 4000, pose: { v1: 100 } },
  ],
  segments: [],
  markers: [
    { id: "m2", atMs: 3000, name: "演员入场" },
    { id: "m1", atMs: 2000, name: "灯光切换" },
  ],
};

let restorePaneWidth: (() => void) | undefined;
beforeEach(() => {
  restorePaneWidth = installTimelinePaneWidth();
});
afterEach(() => {
  restorePaneWidth?.();
  cleanup();
});

describe("timeline markers", () => {
  it("draws each marker with its name in time order, plus a line through the tracks", () => {
    render(<TimelineEditor {...createTimelineProps(sequence)} />);
    const flags = screen.getAllByRole("button", { name: /^标记 / });
    expect(flags.map((flag) => flag.getAttribute("aria-label"))).toEqual([
      "标记 灯光切换",
      "标记 演员入场",
    ]);
    expect(flags[0]!.textContent).toContain("灯光切换");
    expect(document.querySelectorAll("[data-testid='timeline-marker-line']")).toHaveLength(2);
  });

  it("shows the marker lane only when the sequence has a marker", () => {
    render(<TimelineEditor {...createTimelineProps({ ...sequence, markers: [] })} />);
    expect(screen.queryByTestId("timeline-marker-lane")).toBeNull();
    expect(screen.queryByText("标记")).toBeNull();
    cleanup();
    render(<TimelineEditor {...createTimelineProps(sequence)} />);
    expect(screen.getByTestId("timeline-marker-lane")).not.toBeNull();
  });

  it("selects a marker and moves the playhead to it; Ctrl/⌘ adds to the selection", () => {
    const onSelectionChange = vi.fn();
    const onCursorChange = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence, onSelectionChange)}
        onCursorChange={onCursorChange}
        selection={{ kind: "markers", markerIds: ["m2"] }}
      />,
    );
    expect(screen.getByRole("button", { name: "标记 演员入场" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "标记 灯光切换" }));
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: "markers", markerIds: ["m1"] });
    expect(onCursorChange).toHaveBeenLastCalledWith(2000);

    onCursorChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "标记 灯光切换" }), { ctrlKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: "markers", markerIds: ["m2", "m1"] });
    expect(onCursorChange).not.toHaveBeenCalled();
  });

  it("drags a marker with snapping and keeps it selected", () => {
    const onSelectionChange = vi.fn();
    const onMarkersShift = vi.fn();
    const onMarkersShiftEnd = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence, onSelectionChange)}
        onMarkersShift={onMarkersShift}
        onMarkersShiftEnd={onMarkersShiftEnd}
      />,
    );
    const flag = screen.getByRole("button", { name: "标记 灯光切换" });
    // 100 px/s：拖 197 px 到 3.97 s，离另一个标记还远，吸到 4.0 s 的位姿
    fireEvent.pointerDown(flag, { clientX: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 297 });
    fireEvent.pointerUp(window);
    fireEvent.click(flag);
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "markers", markerIds: ["m1"] });
    expect(onMarkersShift).toHaveBeenLastCalledWith(["m1"], 2000);
    expect(onMarkersShiftEnd).toHaveBeenCalledTimes(1);
  });

  it("drags every selected marker together", () => {
    const onMarkersShift = vi.fn();
    render(
      <TimelineEditor
        {...createTimelineProps(sequence)}
        selection={{ kind: "markers", markerIds: ["m1", "m2"] }}
        onMarkersShift={onMarkersShift}
      />,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "标记 演员入场" }), {
      clientX: 100,
      button: 0,
    });
    fireEvent.pointerMove(window, { clientX: 150 });
    fireEvent.pointerUp(window);
    expect(onMarkersShift).toHaveBeenLastCalledWith(["m1", "m2"], 500);
  });

  it("asks to rename on double click", () => {
    const onMarkerRename = vi.fn();
    render(<TimelineEditor {...createTimelineProps(sequence)} onMarkerRename={onMarkerRename} />);
    fireEvent.doubleClick(screen.getByRole("button", { name: "标记 演员入场" }));
    expect(onMarkerRename).toHaveBeenCalledWith(sequence.markers![0]);
  });

  it("lets blocks snap onto markers", () => {
    const onPoseMove = vi.fn();
    render(<TimelineEditor {...createTimelineProps(sequence)} onPoseMove={onPoseMove} />);
    // 位姿 a1 在 1.0 s：拖 97 px 到 1.97 s，3 px 外是 2.0 s 的标记
    const pose = screen.getByRole("button", { name: /位姿 a1/ });
    fireEvent.pointerDown(pose, { clientX: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 197 });
    fireEvent.pointerUp(window);
    expect(onPoseMove).toHaveBeenLastCalledWith("a1", 2000);
  });
});
