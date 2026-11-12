// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import type { DisplayLengthUnit } from "@/app/project/display-length-units";
import { Emitter } from "@/app/viz3d/events";
import { MeasureTool, type MeasureState } from "@/app/viz3d/measure/MeasureTool";

/** 引擎替身：真实的 MeasureTool，格子里 1px = 0.001m、落在地面上 */
const fake = vi.hoisted(() => ({ engine: null as unknown }));

vi.mock("../Viz3DProvider", () => ({ useViz3DContext: () => fake.engine }));

import { MeasureToolPanel } from "./MeasureToolPanel";

const createEngine = () => {
  const events = new Emitter<{ measureChange: MeasureState }>();
  const tool: MeasureTool = new MeasureTool(
    (x, y) => ({ point: { x: x / 1000, y: y / 1000, z: 0 }, snap: "ground" }),
    () => [],
    () => events.emit("measureChange", tool.getState()),
  );
  const engine = {
    events,
    getMeasureState: () => tool.getState(),
    setMeasureSnapVertices: (on: boolean) => tool.setSnapVertices(on),
    deleteSelectedMeasurement: () => tool.deleteSelected(),
    clearMeasurements: () => tool.clear(),
  };
  fake.engine = engine;
  return tool;
};

const draw = (tool: MeasureTool, to: [number, number]) => {
  tool.pointerDown({ x: 0, y: 0, pointerId: 1, toggleSnap: false, cellId: "main", coarse: false });
  tool.pointerMove({ x: to[0], y: to[1], pointerId: 1, toggleSnap: false });
  tool.pointerUp({ x: to[0], y: to[1], pointerId: 1, toggleSnap: false });
};

const renderPanel = (unit: DisplayLengthUnit = "mm") =>
  render(
    <DisplayLengthUnitProvider initialUnit={unit}>
      <MeasureToolPanel onPointerGuard={() => {}} />
    </DisplayLengthUnitProvider>,
  );

afterEach(() => cleanup());

describe("MeasureToolPanel", () => {
  it("prompts to draw, then shows the selected ruler's length and X / Y / Z", () => {
    const tool = createEngine();
    renderPanel();
    expect(screen.getByRole("region", { name: "测量" }).textContent).toContain("按住左键拖动，画一条标尺");
    expect(screen.getByRole("button", { name: "删除" })).toHaveProperty("disabled", true);

    act(() => draw(tool, [300, 400]));
    const text = screen.getByRole("region", { name: "测量" }).textContent ?? "";
    expect(text).toContain("长度500.0 mm");
    expect(text).toContain("X300.0 mm");
    expect(text).toContain("Y400.0 mm");
    expect(text).toContain("Z0.0 mm");
  });

  it("follows the user's display unit", () => {
    const tool = createEngine();
    renderPanel("m");
    act(() => draw(tool, [300, 400]));
    expect(screen.getByRole("region", { name: "测量" }).textContent).toContain("长度0.5000 m");
  });

  it("toggles vertex snapping, deletes the selected ruler and clears all", () => {
    const tool = createEngine();
    renderPanel();
    const snap = screen.getByRole("button", { name: "吸附顶点" });
    fireEvent.click(snap);
    expect(snap.getAttribute("aria-pressed")).toBe("true");
    expect(tool.getState().snapVertices).toBe(true);

    act(() => {
      draw(tool, [100, 0]);
      draw(tool, [200, 0]);
    });
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(tool.getRulers()).toHaveLength(1);
    expect(screen.getByRole("region", { name: "测量" }).textContent).toContain("点标尺选中，拖端点修改");
    fireEvent.click(screen.getByRole("button", { name: "全部清除" }));
    expect(tool.getRulers()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "全部清除" })).toHaveProperty("disabled", true);
  });
});
