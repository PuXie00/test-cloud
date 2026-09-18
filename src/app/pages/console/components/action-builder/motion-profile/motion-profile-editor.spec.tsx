// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import type { AxisMotionProfiles, MotionProfile } from "@/app/project/action-sequence/types";
import {
  MotionProfileEditor,
  type MotionProfileAxisContext,
} from "./motion-profile-editor";

const defaultTravel = { v1: 900, v2: 0, v3: 0 };

const profiles1000 = (): AxisMotionProfiles => createDefaultAxisProfiles(5000, { v1: 1, v2: 1 });

const axisContext = (
  overrides: Partial<MotionProfileAxisContext> = {},
): MotionProfileAxisContext => ({
  enabledAxes: ["v1", "v2"],
  travel: defaultTravel,
  durationMs: 5000,
  minAccelTimeByAxis: { v1: 1, v2: 1 },
  ...overrides,
});

const renderEditor = (
  overrides: Partial<Parameters<typeof MotionProfileEditor>[0]> = {},
) => {
  const onChange = vi.fn();
  const view = render(
    <MotionProfileEditor
      value={profiles1000()}
      onChange={onChange}
      axisContext={axisContext()}
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

describe("MotionProfileEditor", () => {
  it("lists only ownedAxes intersected with enabledAxes", () => {
    renderEditor({
      ownedAxes: ["v1"],
      axisContext: axisContext({ enabledAxes: ["v1", "v2"] }),
    });

    expect(screen.getByRole("button", { name: "V1" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "V2" })).toBeNull();
  });

  it("selects the largest-travel axis by default and shows chart sliders at 20%", () => {
    renderEditor();

    expect(screen.getByRole("button", { name: "V1" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "V2" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.queryByRole("button", { name: "V3" })).toBeNull();
    expect(screen.getByRole("slider", { name: "加速结束" }).getAttribute("aria-valuenow")).toBe(
      "20",
    );
    expect(screen.getAllByRole("combobox", { name: "曲线类型" })).toHaveLength(1);
  });

  it("keeps compact second fields without chart sliders", () => {
    renderEditor({ compact: true });

    expect(screen.queryByRole("slider", { name: "加速结束" })).toBeNull();
    expect(screen.getByRole("spinbutton", { name: "加速时间" })).not.toBeNull();
    expect(screen.getByRole("combobox", { name: "曲线类型" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "V1" })).toBeNull();
  });

  it("switches the pressed axis in local state only", () => {
    const { onChange } = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "V2" }));

    expect(screen.getByRole("button", { name: "V2" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "V1" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("editing V2 accel time does not change v1 in onChange payload", () => {
    const { onChange } = renderEditor({
      axisContext: axisContext({ travel: { v1: 900, v2: 10, v3: 0 } }),
    });

    fireEvent.click(screen.getByRole("button", { name: "V2" }));
    changeSpinbutton("加速时间", "1.5");

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as AxisMotionProfiles;
    if (next.v1.kind !== "trapezoid" || next.v2.kind !== "trapezoid") {
      throw new Error("expected trapezoid axes");
    }
    expect(next.v1.params.accelMs).toBe(1000);
    expect(next.v2.params.accelMs).toBe(1500);
  });

  it("shows 匀速时间 as read-only", () => {
    renderEditor();
    expect(screen.getByRole("spinbutton", { name: "匀速时间" }).getAttribute("aria-readonly")).toBe(
      "true",
    );
  });

  it("omits velocity-max when travel is zero even if maxSpeed is set", () => {
    const { container } = renderEditor({
      axisContext: axisContext({
        travel: { v1: 0, v2: 0, v3: 0 },
        maxSpeedByAxis: { v1: 500 },
      }),
    });

    expect(container.querySelector('[data-testid="velocity-max"]')).toBeNull();
    expect(screen.queryByRole("slider", { name: "加速结束" })).toBeNull();
  });

  it("shows 未知曲线 and no sliders for an unknown kind on the current axis", () => {
    const profiles = profiles1000();
    const unknownProfile = {
      kind: "unknown",
      params: { accelMs: 1000, decelMs: 1000 },
    } as MotionProfile;
    profiles.v1 = unknownProfile;

    renderEditor({ value: profiles });

    expect(screen.getByText("未知曲线")).not.toBeNull();
    expect(screen.queryByRole("slider", { name: "加速结束" })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "加速时间" })).toBeNull();
  });

  it("shows 超过上限 copy when peak velocity exceeds the axis max", () => {
    renderEditor({
      axisContext: axisContext({
        maxSpeedByAxis: { v1: 100 },
      }),
    });

    expect(screen.getByText("超过上限 100")).not.toBeNull();
  });

  it("does not show 超过上限 for acceleration or deceleration", () => {
    renderEditor({
      axisContext: axisContext({
        maxSpeedByAxis: { v1: 10_000 },
      }),
    });

    expect(screen.queryByText(/超过上限/)).toBeNull();
    expect(screen.getAllByLabelText("加速度").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("减速度").length).toBeGreaterThan(0);
  });

  it("disables chart sliders and time fields when disabled", () => {
    renderEditor({ disabled: true });

    expect(screen.queryByRole("slider", { name: "加速结束" })).toBeNull();
    expect(screen.getByRole("spinbutton", { name: "加速时间" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("combobox", { name: "曲线类型" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("lists other enabled axes under 全部轴", () => {
    renderEditor();

    const fold = screen.getByText("全部轴").closest("details");
    expect(fold).not.toBeNull();
    expect(within(fold!).getByText("V2")).not.toBeNull();
    expect(within(fold!).queryByText("V1")).toBeNull();
  });

  it("renders chart time ticks and velocity-max when maxSpeed is set", () => {
    const { container } = renderEditor({
      axisContext: axisContext({
        maxSpeedByAxis: { v1: 500 },
      }),
    });

    expect(container.querySelectorAll('[data-testid="time-tick"]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="velocity-max"]')).not.toBeNull();
  });

  it("shows idle chart and read-only zero phases when the selected axis has no travel", () => {
    renderEditor({
      value: {
        v1: { kind: "idle" },
        v2: { kind: "trapezoid", params: { accelMs: 1000, decelMs: 1000 } },
        v3: { kind: "idle" },
      },
      axisContext: axisContext({
        enabledAxes: ["v1"],
        travel: { v1: 0, v2: 0, v3: 0 },
        minAccelTimeByAxis: { v1: 1 },
      }),
      segmentContext: { fromRef: "a", toRef: "b" },
    });

    expect(screen.queryByRole("slider", { name: "加速结束" })).toBeNull();
    expect(screen.getByText("静止")).not.toBeNull();
    expect(screen.getByRole("spinbutton", { name: "加速时间" })).toHaveProperty("readOnly", true);
    expect(screen.getByRole("spinbutton", { name: "加速时间" })).toHaveProperty("value", "0.0");
    expect(screen.getByRole("spinbutton", { name: "减速时间" })).toHaveProperty("value", "0.0");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByLabelText("峰值速度").textContent).toContain("0");
  });

  it("shows peak velocity and accel/decel coefficients with one decimal", () => {
    renderEditor({
      value: {
        v1: { kind: "trapezoid", params: { accelMs: 200, decelMs: 200 } },
        v2: { kind: "idle" },
        v3: { kind: "idle" },
      },
      axisContext: axisContext({
        enabledAxes: ["v1"],
        travel: { v1: 33, v2: 0, v3: 0 },
        durationMs: 1000,
      }),
    });

    expect(screen.getByLabelText("峰值速度").textContent).toBe("41.3 mm/s");
    expect(screen.getByLabelText("加速度").textContent).toBe("206.3 mm/s²");
    expect(screen.getByLabelText("减速度").textContent).toBe("206.3 mm/s²");
  });
});
