// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MotionProfile } from "@/app/project/action-sequence/types";
import { TrapezoidProfileEditor } from "./trapezoid-profile-editor";

const profile10003000 = (): MotionProfile => ({
  kind: "trapezoid",
  params: { accelMs: 1000, decelMs: 1000 },
});

const renderEditor = (
  value: MotionProfile = profile10003000(),
  overrides: Partial<Parameters<typeof TrapezoidProfileEditor>[0]> = {},
) => {
  const onChange = vi.fn();
  const view = render(
    <TrapezoidProfileEditor
      value={value}
      durationMs={5000}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange, ...view };
};

const changeSpinbutton = (name: string, nextValue: string) => {
  const input = screen.getByRole("spinbutton", { name });
  fireEvent.change(input, { target: { value: nextValue } });
  fireEvent.blur(input);
};

afterEach(() => {
  cleanup();
});

describe("TrapezoidProfileEditor", () => {
  it("shows trapezoid curve type and 1000/3000/1000 ms phase times at duration 5000", () => {
    renderEditor();

    const curveType = screen.getByRole("combobox", { name: "曲线类型" });
    expect(curveType).not.toBeNull();
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["梯形"]);

    expect(screen.getByRole("spinbutton", { name: "加速时间" })).toHaveProperty("value", "1000");
    expect(screen.getByRole("spinbutton", { name: "匀速时间" })).toHaveProperty("value", "3000");
    expect(screen.getByRole("spinbutton", { name: "减速时间" })).toHaveProperty("value", "1000");
  });

  it("marks 匀速时间 as read-only", () => {
    renderEditor();
    expect(screen.getByRole("spinbutton", { name: "匀速时间" }).getAttribute("aria-readonly")).toBe(
      "true",
    );
  });

  it("updates accelMs when acceleration time changes to 1500", () => {
    const { onChange } = renderEditor();
    changeSpinbutton("加速时间", "1500");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].params).toEqual({ accelMs: 1500, decelMs: 1000 });
  });

  it("updates decelMs when deceleration time changes to 1500", () => {
    const { onChange } = renderEditor();
    changeSpinbutton("减速时间", "1500");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].params).toEqual({ accelMs: 1000, decelMs: 1500 });
  });

  it("does not emit when cruise is edited because it is read-only", () => {
    const { onChange } = renderEditor();
    const cruise = screen.getByRole("spinbutton", { name: "匀速时间" });
    fireEvent.change(cruise, { target: { value: "2000" } });
    fireEvent.blur(cruise);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not emit invalid profiles for 0 or non-finite values", () => {
    const { onChange } = renderEditor();

    changeSpinbutton("加速时间", "0");
    changeSpinbutton("减速时间", "0");
    changeSpinbutton("加速时间", "abc");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables curve type selector and editable phase fields when disabled", () => {
    renderEditor(profile10003000(), { disabled: true });

    expect(screen.getByRole("combobox", { name: "曲线类型" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("spinbutton", { name: "加速时间" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("spinbutton", { name: "减速时间" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("spinbutton", { name: "匀速时间" })).toHaveProperty("disabled", true);
  });
});
