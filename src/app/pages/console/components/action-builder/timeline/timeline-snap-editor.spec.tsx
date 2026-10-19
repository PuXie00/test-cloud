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
    { id: "a", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 0 } },
    { id: "b", kind: "pose", objectId: 8, atMs: 3000, pose: { v1: 0 } },
    { id: "c", kind: "pose", objectId: 7, atMs: 6000, pose: { v1: 0 } },
    { id: "d", kind: "pose", objectId: 8, atMs: 8000, pose: { v1: 0 } },
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

/** 100 px/s：拖 95 px = 950 ms */
const dragPose = (name: RegExp, dx: number, altKey = false) => {
  const pose = screen.getByRole("button", { name });
  fireEvent.pointerDown(pose, { clientX: 100, button: 0 });
  fireEvent.pointerMove(window, { clientX: 100 + dx, altKey });
};

describe("timeline snapping", () => {
  it("snaps a dragged pose to another row's pose and shows where", () => {
    const onPoseMove = vi.fn();
    render(<TimelineEditor {...createTimelineProps(sequence)} onPoseMove={onPoseMove} />);
    dragPose(/位姿 a/, 95);
    expect(onPoseMove).toHaveBeenLastCalledWith("a", 3000);
    expect(screen.getByTestId("timeline-snap-line").dataset.snapMs).toBe("3000");
    fireEvent.pointerUp(window);
    expect(screen.queryByTestId("timeline-snap-line")).toBeNull();
  });

  it("does not snap to the dragged pose's own row, with Alt held or when snapping is off", () => {
    const onPoseMove = vi.fn();
    const { rerender } = render(
      <TimelineEditor {...createTimelineProps(sequence)} onPoseMove={onPoseMove} />,
    );
    // c（物体 7）在 6000，同一行的 a 拖到 5950 不吸过去
    dragPose(/位姿 a/, 395);
    expect(onPoseMove).toHaveBeenLastCalledWith("a", 5950);
    fireEvent.pointerUp(window);

    dragPose(/位姿 a/, 95, true);
    expect(onPoseMove).toHaveBeenLastCalledWith("a", 2950);
    fireEvent.pointerUp(window);

    rerender(
      <TimelineEditor {...createTimelineProps(sequence)} onPoseMove={onPoseMove} snapEnabled={false} />,
    );
    dragPose(/位姿 a/, 95);
    expect(onPoseMove).toHaveBeenLastCalledWith("a", 2950);
    expect(screen.queryByTestId("timeline-snap-line")).toBeNull();
  });

  it("snaps the playhead to keyframes when scrubbing the ruler, not when stepping with keys", () => {
    const onCursorChange = vi.fn();
    render(<TimelineEditor {...createTimelineProps(sequence)} onCursorChange={onCursorChange} />);
    const ruler = screen.getByRole("slider", { name: "时间标尺（秒）" });
    fireEvent.pointerDown(ruler, { clientX: 296, button: 0 });
    expect(onCursorChange).toHaveBeenLastCalledWith(3000);
    fireEvent.pointerUp(window);

    fireEvent.keyDown(ruler, { key: "ArrowRight" });
    expect(onCursorChange).toHaveBeenLastCalledWith(100);
    // Alt+→ 留给跳关键帧
    onCursorChange.mockClear();
    fireEvent.keyDown(ruler, { key: "ArrowRight", altKey: true });
    expect(onCursorChange).not.toHaveBeenCalled();
  });
});

describe("timeline view requests", () => {
  it("fits the whole sequence when asked", () => {
    const onTimelinePxPerSecondChange = vi.fn();
    const props = { ...createTimelineProps(sequence), onTimelinePxPerSecondChange };
    const { rerender } = render(<TimelineEditor {...props} />);
    expect(onTimelinePxPerSecondChange).not.toHaveBeenCalled();
    rerender(<TimelineEditor {...props} fitRequestId={1} />);
    // 800 px 宽的时间轴，8 s × 1.05
    expect(onTimelinePxPerSecondChange.mock.calls[0]?.[0]).toBeCloseTo((800 - 8) / 8.4);
  });

  it("brings a jumped playhead back into view", () => {
    const props = { ...createTimelineProps(sequence), cursorMs: 30_000 };
    const { rerender } = render(<TimelineEditor {...props} />);
    const playhead = () => screen.getByTestId("timeline-playhead-line").style.left;
    expect(playhead()).toBe("3008px");
    rerender(<TimelineEditor {...props} revealCursorRequestId={1} />);
    // 视野 7920 ms，指针放到中间
    expect(playhead()).toBe("404px");
  });
});
