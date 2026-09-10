// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineHScroll } from "./timeline-h-scroll";

afterEach(() => cleanup());

describe("TimelineHScroll", () => {
  it("drags the thumb to change viewStart", () => {
    const onViewStartChange = vi.fn();
    render(
      <TimelineHScroll
        viewStartMs={0}
        viewportMs={8000}
        totEndMs={16000}
        onViewStartChange={onViewStartChange}
      />,
    );
    const track = document.querySelector("[data-testid='timeline-h-scroll']") as HTMLElement;
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
    const thumb = track.querySelector("[data-testid='timeline-h-scroll-thumb']") as HTMLElement;
    fireEvent.pointerDown(thumb, { clientX: 10, button: 0 });
    fireEvent.pointerMove(window, { clientX: 60 });
    fireEvent.pointerUp(window);
    expect(onViewStartChange).toHaveBeenCalledWith(4000);
  });

  it("clicks the track to jump viewStart", () => {
    const onViewStartChange = vi.fn();
    render(
      <TimelineHScroll
        viewStartMs={0}
        viewportMs={8000}
        totEndMs={16000}
        onViewStartChange={onViewStartChange}
      />,
    );
    const track = document.querySelector("[data-testid='timeline-h-scroll']") as HTMLElement;
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
    fireEvent.pointerDown(track, { clientX: 100, button: 0 });
    expect(onViewStartChange).toHaveBeenCalledWith(4000);
  });
});
