// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SequencePreviewValue } from "../../hooks/use-sequence-preview";
import { SequencePreviewBar } from "./sequence-preview-bar";

const { preview, play, pause, stopPreview, setCursorMs, setMultiplier } = vi.hoisted(() => {
  const play = vi.fn();
  const pause = vi.fn();
  const stopPreview = vi.fn();
  const setCursorMs = vi.fn();
  const setMultiplier = vi.fn();
  const preview: { current: SequencePreviewValue } = {
    current: {
      sequenceId: 1,
      cursorMs: 5200,
      isPlaying: false,
      holdMode: false,
      faderPercent: 100,
      multiplier: 1,
      totalMs: 12300,
      resolved: null,
      timeline: null,
      startPreview: vi.fn(),
      togglePreview: vi.fn(),
      stopPreview,
      setCursorMs,
      play,
      pause,
      setMultiplier,
    },
  };
  return { preview, play, pause, stopPreview, setCursorMs, setMultiplier };
});

vi.mock("../../hooks/use-sequence-preview", () => ({
  useSequencePreview: () => preview.current,
}));

const resetPreview = () => {
  preview.current = {
    ...preview.current,
    sequenceId: 1,
    cursorMs: 5200,
    isPlaying: false,
    holdMode: false,
    faderPercent: 100,
    multiplier: 1,
    totalMs: 12300,
    resolved: null,
    timeline: null,
    play,
    pause,
    stopPreview,
    setCursorMs,
    setMultiplier,
  };
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetPreview();
});

describe("SequencePreviewBar", () => {
  it("renders 00:05.2 / 00:12.3", () => {
    render(<SequencePreviewBar />);
    expect(screen.getByText("00:05.2 / 00:12.3")).toBeTruthy();
  });

  it("play button label flips with isPlaying", () => {
    const { rerender } = render(<SequencePreviewBar />);
    expect(screen.getByRole("button", { name: "播放" })).toBeTruthy();
    preview.current = { ...preview.current, isPlaying: true };
    rerender(<SequencePreviewBar />);
    expect(screen.getByRole("button", { name: "暂停" })).toBeTruthy();
  });

  it("paused at the end shows 重新播放 and click calls play", () => {
    preview.current = { ...preview.current, cursorMs: 12300, totalMs: 12300, isPlaying: false };
    render(<SequencePreviewBar />);
    const replay = screen.getByRole("button", { name: "重新播放" });
    expect(replay).toBeTruthy();
    fireEvent.click(replay);
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it("clicking close calls stopPreview", () => {
    render(<SequencePreviewBar />);
    fireEvent.click(screen.getByRole("button", { name: "退出预览" }));
    expect(stopPreview).toHaveBeenCalledTimes(1);
  });

  it("Escape keydown on window calls stopPreview", () => {
    render(<SequencePreviewBar />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(stopPreview).toHaveBeenCalledTimes(1);
  });

  it("marks the transition segment and switches to program time after it", () => {
    const timeline = {
      plan: null,
      transitionMs: 3000,
      direction: 1 as const,
      programStartMs: 4000,
      programTotalMs: 12000,
      totalMs: 11000,
    };
    preview.current = { ...preview.current, timeline, totalMs: 11000, cursorMs: 1200 };
    const { rerender } = render(<SequencePreviewBar />);
    expect(screen.getByText("过渡")).toBeTruthy();
    expect(screen.getByText(/00:01\.2 \/ 00:03\.0/)).toBeTruthy();
    const segment = screen.getByTestId("preview-transition-segment") as HTMLElement;
    expect(segment.style.width).toBe(`${(3000 / 11000) * 100}%`);

    preview.current = { ...preview.current, cursorMs: 3500 };
    rerender(<SequencePreviewBar />);
    expect(screen.queryByText("过渡")).toBeNull();
    expect(screen.getByText("00:04.5 / 00:12.0")).toBeTruthy();
  });

  it("clicking 4× calls setMultiplier(4)", () => {
    render(<SequencePreviewBar />);
    fireEvent.click(screen.getByRole("button", { name: "4×" }));
    expect(setMultiplier).toHaveBeenCalledWith(4);
  });
});
