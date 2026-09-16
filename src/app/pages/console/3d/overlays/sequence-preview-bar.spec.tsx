// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SequencePreviewValue } from "../../hooks/sequence-preview-provider";
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

vi.mock("../../hooks/sequence-preview-provider", () => ({
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

  it("clicking 4× calls setMultiplier(4)", () => {
    render(<SequencePreviewBar />);
    fireEvent.click(screen.getByRole("button", { name: "4×" }));
    expect(setMultiplier).toHaveBeenCalledWith(4);
  });
});
