// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NumericInput } from "./numeric-input";

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
});

afterEach(() => cleanup());

describe("NumericInput dragging", () => {
  it("shows every value while dragging even when the parent only listens to onCommit", () => {
    const onCommit = vi.fn();
    render(<NumericInput aria-label="经过速度" value={150} precision={1} onCommit={onCommit} />);
    const readout = screen.getByLabelText("经过速度");
    fireEvent.pointerDown(readout, { pointerId: 1, button: 0, clientX: 100 });
    const shown: string[] = [];
    for (const x of [104, 105, 106, 110]) {
      fireEvent.pointerMove(readout, { pointerId: 1, clientX: x });
      shown.push(readout.textContent ?? "");
    }
    expect(shown).toEqual(["154.0", "155.0", "156.0", "160.0"]);
    fireEvent.pointerUp(readout, { pointerId: 1, button: 0, clientX: 110 });
    expect(onCommit).toHaveBeenCalledWith(160);
    expect(readout.textContent).toBe("150.0");
  });
});
