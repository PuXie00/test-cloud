// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import { BuildDebugContext, type BuildDebugContextValue } from "./build-debug-context";
import type { BuildMotorTelemetry } from "./build-debug-types";
import { MotorTelemetryOverlay } from "./motor-telemetry-overlay";

const engine = {
  // 两个吊点分属不同物体、相机很近 → 不聚合，各自一个徽章
  getBoundHoistScreenPositions: () => [
    { motorId: "11", objectId: "5", x: 100, y: 100, visible: true },
    { motorId: "12", objectId: "6", x: 300, y: 100, visible: true },
  ],
  getLabelCellId: () => "main",
  getPose: () => ({ position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 } }),
};

vi.mock("@/app/pages/console/3d/Viz3DProvider", () => ({
  useViz3DContext: () => engine,
}));

vi.mock("@/app/pages/console/hooks/use-project-store", () => ({
  useProjectStore: () => ({
    motors: [],
    findMotor: (id: number) => ({ id }),
  }),
}));

vi.mock("@/app/pages/console/hooks/motor-mid", () => ({
  formatMotorDisplayName: (_motors: unknown, m: { id: number }) => `M${m.id}`,
}));

const telemetry: Record<number, BuildMotorTelemetry> = {
  11: { status: "moving", values: { actualPosition: 1300, actualSpeed: -25 } },
};

const debugValue = (): BuildDebugContextValue =>
  ({
    armed: true,
    primaryMotorId: 11,
    selectedMotorIds: new Set([11]),
    displayPositionOf: (id: number) => (id === 11 ? 1234.5 : 0),
    telemetryOf: (id: number) => telemetry[id] ?? { status: "powerOff", values: {} },
    imbalancedInObject: () => new Set<number>(),
    isMotorOnline: (id: number) => id === 11,
  }) as unknown as BuildDebugContextValue;

beforeEach(() => {
  // 只跑一帧：足够把吊点位置读进来
  let frames = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames += 1;
    if (frames === 1) cb(0);
    return frames;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderOverlay = () =>
  render(
    <DisplayLengthUnitProvider initialUnit="mm">
      <BuildDebugContext.Provider value={debugValue()}>
        <MotorTelemetryOverlay />
      </BuildDebugContext.Provider>
    </DisplayLengthUnitProvider>,
  );

describe("3D 吊点徽章", () => {
  it("在线电机：名称旁只显示位置数值，不带前缀、不显示速度", () => {
    const { container } = renderOverlay();
    const badge = container.querySelector<HTMLElement>('[data-motor-badge="11"]')!;
    expect(badge).not.toBeNull();
    expect(badge.querySelectorAll("[data-readout]")).toHaveLength(0);
    expect(badge.textContent).toContain("M11");
    expect(badge.textContent).toContain("1234.5");
    expect(badge.textContent).not.toContain("p:");
    expect(badge.textContent).not.toContain("s:");
    expect(badge.textContent).not.toContain("-25");
    expect(badge.querySelector("[title='位置']")).not.toBeNull();
  });

  it("离线电机只写离线，不出数据", () => {
    const { container } = renderOverlay();
    const badge = container.querySelector<HTMLElement>('[data-motor-badge="12"]')!;
    expect(badge.querySelectorAll("[data-readout]")).toHaveLength(0);
    expect(badge.textContent).toContain("离线");
  });
});
