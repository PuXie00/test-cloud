// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import type { DisplayLengthUnit } from "@/app/project/display-length-units";
import { NumericInput, type NumericInputProps } from "./numeric-input";
import { UnitAwareNumericInput } from "./unit-aware-numeric-input";

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
});

afterEach(() => cleanup());

const LABEL = "经过速度";

/** 点一下读数（不拖）进入键入 */
const startEditing = () => {
  const readout = screen.getByLabelText(LABEL);
  fireEvent.pointerDown(readout, { pointerId: 1, button: 0, clientX: 100 });
  fireEvent.pointerUp(readout, { pointerId: 1, button: 0, clientX: 100 });
  return screen.getByRole("textbox") as HTMLInputElement;
};

/** 一个字一个字打：每次 change 都是框里的整段文字 */
const typeEach = (input: HTMLInputElement, texts: string[]) =>
  texts.map((text) => {
    fireEvent.change(input, { target: { value: text } });
    return input.value;
  });

const renderNumeric = (props: Partial<NumericInputProps> = {}) => {
  const onCommit = vi.fn();
  const onChange = vi.fn();
  render(
    <NumericInput aria-label={LABEL} value={150} onChange={onChange} onCommit={onCommit} {...props} />,
  );
  return { onCommit, onChange };
};

describe("NumericInput typing decimals", () => {
  it("keeps a typed decimal on a step-1 / precision-1 field instead of snapping to the step", () => {
    const { onCommit } = renderNumeric({ step: 1, precision: 1 });
    const input = startEditing();
    expect(typeEach(input, ["1", "12", "12.", "12.5"])).toEqual(["1", "12", "12.", "12.5"]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(12.5);
  });

  it("keeps intermediate drafts: '.5', '-', '-0.', '-0.5'", () => {
    const { onCommit } = renderNumeric({ step: 0.1 });
    const input = startEditing();
    expect(typeEach(input, ["", ".", ".5"])).toEqual(["", ".", ".5"]);
    expect(typeEach(input, ["", "-", "-0", "-0.", "-0.5"])).toEqual(["", "-", "-0", "-0.", "-0.5"]);
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(-0.5);
  });

  it("drops digits past the precision while typing", () => {
    renderNumeric({ precision: 1 });
    const input = startEditing();
    expect(typeEach(input, ["1.2", "1.25"])).toEqual(["1.2", "1.2"]);
  });

  it("integer-only fields reject the decimal point and letters", () => {
    const { onCommit } = renderNumeric({ value: 3 });
    const input = startEditing();
    expect(input.value).toBe("3");
    expect(typeEach(input, ["3.", "3a", "35"])).toEqual(["3", "3", "35"]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(35);
  });

  it("still clamps typed values to min / max", () => {
    const { onCommit } = renderNumeric({ precision: 1, min: 0, max: 100 });
    const input = startEditing();
    typeEach(input, ["250.5"]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(100);
  });

  it("a cleared or unfinished draft commits nothing and shows the old value", () => {
    const { onCommit, onChange } = renderNumeric({ precision: 1 });
    let input = startEditing();
    typeEach(input, ["-"]);
    fireEvent.keyDown(input, { key: "Enter" });
    input = startEditing();
    typeEach(input, [""]);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText(LABEL).textContent).toBe("150.0");
  });

  it("Escape discards the draft", () => {
    const { onCommit } = renderNumeric({ precision: 1 });
    const input = startEditing();
    typeEach(input, ["9.5"]);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByLabelText(LABEL).textContent).toBe("150.0");
  });

  it("ignores Enter / Escape while an IME is composing", () => {
    const { onCommit } = renderNumeric({ precision: 1 });
    const input = startEditing();
    typeEach(input, ["2.5"]);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
    expect(screen.getByRole("textbox")).toBe(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("selects the whole value when editing starts", () => {
    renderNumeric({ precision: 1 });
    const input = startEditing();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, "150.0".length]);
  });

  it("step buttons still snap to the step", () => {
    const { onCommit } = renderNumeric({ value: 12.3, step: 1, precision: 1 });
    fireEvent.mouseDown(screen.getByRole("button", { name: "增加" }));
    expect(onCommit).toHaveBeenCalledWith(13);
  });
});

describe("UnitAwareNumericInput typing decimals", () => {
  const renderUnitAware = (display: DisplayLengthUnit, value: number) => {
    const onCommit = vi.fn();
    render(
      <DisplayLengthUnitProvider initialUnit={display}>
        <UnitAwareNumericInput
          aria-label={LABEL}
          value={value}
          unit="mm"
          step={1}
          precision={1}
          onCommit={onCommit}
        />
      </DisplayLengthUnitProvider>,
    );
    return onCommit;
  };

  it.each([
    ["mm", "12.5", 12.5],
    ["m", "1.2345", 1234.5],
    ["in", "1.5", 38.1],
  ] as const)("typed %s value %s is not re-snapped to the 1 mm step", (display, typed, canonical) => {
    const onCommit = renderUnitAware(display, 0);
    const input = startEditing();
    typeEach(input, [typed]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(canonical);
  });

  it.each(["mm", "m", "in"] as const)(
    "the + button in %s still lands exactly on the 1 mm grid",
    (display) => {
      const onCommit = renderUnitAware(display, 10);
      fireEvent.mouseDown(screen.getByRole("button", { name: "增加" }));
      expect(onCommit).toHaveBeenCalledWith(11);
    },
  );
});
