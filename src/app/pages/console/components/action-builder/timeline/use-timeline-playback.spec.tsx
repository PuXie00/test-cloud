// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelinePlayback } from "./use-timeline-playback";

const clock = { now: 0 };

const advanceFrames = (count: number) => {
  for (let i = 0; i < count; i += 1) {
    act(() => {
      clock.now += 16;
      vi.advanceTimersByTime(16);
    });
  }
};

const renderPlayback = (initial: { cursorMs?: number; totalMs: number; pauseKey?: unknown }) =>
  renderHook(
    (props: { totalMs: number; pauseKey?: unknown }) => {
      const [cursorMs, setCursorMs] = useState(initial.cursorMs ?? 0);
      const playback = useTimelinePlayback({
        cursorMs,
        totalMs: props.totalMs,
        onCursorMs: setCursorMs,
        pauseKey: props.pauseKey,
      });
      return { cursorMs, playback };
    },
    { initialProps: { totalMs: initial.totalMs, pauseKey: initial.pauseKey } },
  );

beforeEach(() => {
  clock.now = 0;
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockImplementation(() => clock.now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(() => cb(clock.now), 16) as unknown as number,
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useTimelinePlayback", () => {
  it("advances the cursor and stops at totalMs", () => {
    const { result } = renderPlayback({ totalMs: 80 });

    act(() => {
      result.current.playback.play();
    });
    expect(result.current.playback.isPlaying).toBe(true);

    advanceFrames(8);
    expect(result.current.cursorMs).toBe(80);
    expect(result.current.playback.isPlaying).toBe(false);
  });

  it("play at the end rewinds to 0 then plays", () => {
    const { result } = renderPlayback({ cursorMs: 1000, totalMs: 1000 });

    act(() => {
      result.current.playback.play();
    });

    expect(result.current.cursorMs).toBe(0);
    expect(result.current.playback.isPlaying).toBe(true);
  });

  it("does not start when totalMs is 0", () => {
    const { result } = renderPlayback({ totalMs: 0 });

    act(() => {
      result.current.playback.play();
    });

    expect(result.current.playback.isPlaying).toBe(false);
    expect(result.current.cursorMs).toBe(0);
  });

  it("pauses when pauseKey changes", () => {
    const { result, rerender } = renderPlayback({ totalMs: 5000, pauseKey: "a" });

    act(() => {
      result.current.playback.play();
    });
    expect(result.current.playback.isPlaying).toBe(true);

    rerender({ totalMs: 5000, pauseKey: "b" });
    expect(result.current.playback.isPlaying).toBe(false);
  });
});
