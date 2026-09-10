// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAxisProfile } from "@/app/project/action-sequence/motion-profile";
import type { MotionProfile } from "@/app/project/action-sequence/types";
import { VelocityChart } from "./velocity-chart";

const defaultProfile = (): MotionProfile => createDefaultAxisProfile(5000, 1);

const mockPlotRect = (svg: SVGSVGElement, width = 100) => {
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width,
    height: 50,
    right: width,
    bottom: 50,
    toJSON() {
      return {};
    },
  } as DOMRect);
};

afterEach(() => {
  cleanup();
});

describe("VelocityChart", () => {
  it("renders 加速结束 at 20% and 减速开始 at 80% for 1000/1000 ms at duration 5000", () => {
    render(
      <VelocityChart
        profile={defaultProfile()}
        durationMs={5000}
        onProfileChange={vi.fn()}
      />,
    );

    const accelEnd = screen.getByRole("slider", { name: "加速结束" });
    const decelStart = screen.getByRole("slider", { name: "减速开始" });
    expect(accelEnd.getAttribute("aria-valuemin")).toBe("0");
    expect(accelEnd.getAttribute("aria-valuemax")).toBe("100");
    expect(accelEnd.getAttribute("aria-valuenow")).toBe("20");
    expect(decelStart.getAttribute("aria-valuenow")).toBe("80");
  });

  it("renders time ticks at accel-end, cruise-end, and decel-end in seconds", () => {
    const { container } = render(
      <VelocityChart
        profile={defaultProfile()}
        durationMs={5000}
        onProfileChange={vi.fn()}
      />,
    );

    const ticks = [...container.querySelectorAll('[data-testid="time-tick"]')];
    expect(ticks.map((tick) => tick.getAttribute("data-tick"))).toEqual([
      "accel-end",
      "cruise-end",
      "decel-end",
    ]);
    expect(ticks.map((tick) => tick.textContent)).toEqual(["1.00", "4.00", "5.00"]);
    expect((ticks.at(-1) as HTMLElement).style.left).toBe("99.2%");
    expect(container.querySelector('[data-testid="axis-time-title"]')?.textContent).toBe("t/s");
  });

  it("renders velocity-zero tick and velocity-max when maxVelocity is set", () => {
    const { container } = render(
      <VelocityChart
        profile={defaultProfile()}
        durationMs={5000}
        velocityUnit="mm/s"
        limits={{
          peakVelocity: 2,
          maxVelocity: 1.5,
        }}
        onProfileChange={vi.fn()}
      />,
    );

    expect(container.querySelector('[data-testid="velocity-zero"]')).not.toBeNull();
    const maxTick = container.querySelector('[data-testid="velocity-max"]');
    expect(maxTick).not.toBeNull();
    expect(maxTick?.textContent).toBe("1.5");
    expect(container.querySelector('[data-testid="axis-velocity-title"]')?.textContent).toBe(
      "v/(mm/s)",
    );
    expect(container.querySelector('[data-testid="plot-well"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="peak-tick"]')).not.toBeNull();
    const velocityAxis = container.querySelector('[data-testid="axis-velocity"]');
    const timeAxis = container.querySelector('[data-testid="axis-time"]');
    expect(velocityAxis).not.toBeNull();
    expect(timeAxis).not.toBeNull();
    expect(velocityAxis?.querySelector('[data-testid="axis-velocity-arrow"]')).not.toBeNull();
    expect(timeAxis?.querySelector('[data-testid="axis-time-arrow"]')).not.toBeNull();
    expect((maxTick as HTMLElement).style.left).toBe("50%");
    expect(maxTick?.getAttribute("class") ?? "").toContain("warning");
  });

  it("pointer-dragging 加速结束 fires onProfileChange with a larger accelMs", () => {
    const onProfileChange = vi.fn();
    const { container } = render(
      <VelocityChart
        profile={defaultProfile()}
        durationMs={5000}
        onProfileChange={onProfileChange}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    mockPlotRect(svg!);

    fireEvent.pointerDown(screen.getByRole("slider", { name: "加速结束" }), {
      clientX: 20,
      button: 0,
    });
    fireEvent.pointerMove(window, { clientX: 40 });
    fireEvent.pointerUp(window);

    expect(onProfileChange).toHaveBeenCalled();
    const next = onProfileChange.mock.calls.at(-1)?.[0] as MotionProfile;
    expect(next.params.accelMs).toBeGreaterThan(1000);
    expect(next.params.decelMs).toBe(1000);
  });

  it("does not render sliders when disabled", () => {
    render(
      <VelocityChart
        profile={defaultProfile()}
        durationMs={5000}
        disabled
        onProfileChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("omits velocity-max when limits are absent", () => {
    const { container } = render(
      <VelocityChart
        profile={defaultProfile()}
        durationMs={5000}
        onProfileChange={vi.fn()}
      />,
    );

    expect(container.querySelector('[data-testid="velocity-max"]')).toBeNull();
    expect(container.querySelector('[data-testid="peak-tick"]')).toBeNull();
    expect(container.querySelector('[data-testid="velocity-zero"]')).not.toBeNull();
  });

  it("marks cruise with data-limit=velocity when peak exceeds maxVelocity", () => {
    const { container } = render(
      <VelocityChart
        profile={defaultProfile()}
        durationMs={5000}
        limits={{
          peakVelocity: 2,
          maxVelocity: 1,
        }}
        onProfileChange={vi.fn()}
      />,
    );

    const cruise = container.querySelector('[data-phase="cruise"]');
    expect(cruise).not.toBeNull();
    expect(cruise?.getAttribute("data-limit")).toBe("velocity");
    expect(cruise?.getAttribute("class") ?? "").toContain("warning");
    expect(cruise?.getAttribute("class") ?? "").not.toContain("destructive");
    expect(container.querySelector('[data-testid="velocity-limit"]')).not.toBeNull();
  });

  it("scales the trapezoid to peak/max so cruise sits at half height when peak is half of max", () => {
    const { container } = render(
      <VelocityChart
        profile={defaultProfile()}
        durationMs={5000}
        limits={{ peakVelocity: 2, maxVelocity: 4 }}
      />,
    );

    const cruise = container.querySelector('[data-phase="cruise"]');
    const points = cruise?.getAttribute("points")?.split(" ").map((pair) => {
      const [, y] = pair.split(",");
      return Number(y);
    });
    expect(points).toHaveLength(4);
    expect(points![1]).toBeCloseTo(25, 5);
    expect(points![2]).toBeCloseTo(25, 5);
  });

  it("does not mark accel or decel with data-limit when derived accel limits would trip", () => {
    const { container } = render(
      <VelocityChart
        profile={defaultProfile()}
        durationMs={5000}
        limits={{
          peakVelocity: 1,
          maxVelocity: 2,
        }}
        onProfileChange={vi.fn()}
      />,
    );

    expect(container.querySelector('[data-phase="accel"]')?.getAttribute("data-limit")).toBeNull();
    expect(container.querySelector('[data-phase="decel"]')?.getAttribute("data-limit")).toBeNull();
    expect(container.querySelector('[data-phase="cruise"]')?.getAttribute("data-limit")).toBeNull();
  });

  it("ArrowRight on 加速结束 increases accelMs", () => {
    const onProfileChange = vi.fn();
    render(
      <VelocityChart
        profile={defaultProfile()}
        durationMs={5000}
        onProfileChange={onProfileChange}
      />,
    );

    fireEvent.keyDown(screen.getByRole("slider", { name: "加速结束" }), {
      key: "ArrowRight",
    });

    expect(onProfileChange).toHaveBeenCalledTimes(1);
    const next = onProfileChange.mock.calls[0]![0] as MotionProfile;
    expect(next.params.accelMs).toBeCloseTo(1025, 0);
    expect(next.params.decelMs).toBe(1000);
  });
});
