// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { VerticalFader } from "./vertical-fader";

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => false) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
});

expect.extend({
  toHaveAttribute(received: Element, name: string, expected?: string) {
    const actual = received.getAttribute(name);
    const pass = expected === undefined ? actual !== null : actual === expected;
    return {
      pass,
      message: () =>
        pass
          ? `expected element not to have attribute ${name}`
          : `expected element to have attribute ${name}${expected === undefined ? "" : `="${expected}"`}, got "${actual}"`,
    };
  },
});

afterEach(() => {
  cleanup();
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

describe("VerticalFader", () => {
  it("exposes a 0–200 slider and steps from the keyboard", () => {
    const onChange = vi.fn();
    render(<VerticalFader value={100} onChange={onChange} aria-label="F1 速度" />);
    const slider = screen.getByRole("slider", { name: "F1 速度" });
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "200");
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith(101);
    fireEvent.keyDown(slider, { key: "ArrowUp", shiftKey: true });
    expect(onChange).toHaveBeenCalledWith(110);
  });

  it("does not change when disabled", () => {
    const onChange = vi.fn();
    render(<VerticalFader value={100} onChange={onChange} disabled aria-label="F1 速度" />);
    const slider = screen.getByRole("slider", { name: "F1 速度" });
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    fireEvent.pointerDown(slider, { clientY: 0, button: 0, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("maps pointer down and drag on the track", () => {
    const onChange = vi.fn();
    render(<VerticalFader value={100} onChange={onChange} aria-label="F1 速度" />);
    const slider = screen.getByRole("slider", { name: "F1 速度" });
    mockRect(slider, { left: 0, top: 0, width: 16, height: 200 });
    vi.spyOn(slider, "setPointerCapture").mockImplementation(() => {});
    vi.spyOn(slider, "hasPointerCapture").mockReturnValue(true);
    fireEvent.pointerDown(slider, { clientY: 50, button: 0, pointerId: 1 });
    expect(onChange).toHaveBeenCalledWith(150);
    fireEvent.pointerMove(slider, { clientY: 0, pointerId: 1 });
    expect(onChange).toHaveBeenCalledWith(200);
  });
});
