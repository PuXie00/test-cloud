// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import {
  buildAxisCurves,
  curveSampleAt,
  dragValueStep,
  fitCurveScales,
  roundDragValue,
} from "./curve-data";
import { curvePlotLayout, plotValue, plotY } from "./timeline-curves";
import type { ControlledObject } from "./timeline-data";
import { TIMELINE_PAD_LEFT } from "./timeline-data";
import { TimelineEditor, type TimelineEditorProps } from "./timeline-editor";
import { createTimelineProps, installTimelinePaneWidth } from "./timeline-test-helpers";
import { TimelineToolbar } from "./timeline-toolbar";

const sequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: false,
  blocks: [
    { id: "a1", kind: "pose", objectId: 7, atMs: 0, pose: { v1: 0 } },
    { id: "a2", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 1000 } },
    { id: "a3", kind: "pose", objectId: 7, atMs: 4000, pose: { v1: 2000 } },
    { id: "b1", kind: "pose", objectId: 8, atMs: 0, pose: { v1: 500, v2: 0 } },
    // 虚轴 1 在这一帧不设定，从这里经过
    { id: "b2", kind: "pose", objectId: 8, atMs: 1000, pose: { v2: 10 } },
    { id: "b3", kind: "pose", objectId: 8, atMs: 3000, pose: { v1: 1500, v2: 0 } },
  ],
  segments: [],
};

const objectOf = (id: number, name: string, maxSpeed = 5000): ControlledObject => ({
  id,
  name,
  currentPosition: 0,
  unit: "mm",
  axisLabel: "",
  enabled: true,
  enabledAxes: ["v1", "v2"],
  maxSpeedByAxis: { v1: maxSpeed, v2: 100 },
  minAccelTimeByAxis: { v1: 0.1, v2: 0.1 },
  rangeByAxis: { v1: { min: -5000, max: 5000 }, v2: { min: -90, max: 90 } },
});

const objects = [objectOf(7, "升降台 7"), objectOf(8, "吊杆 8")];

// jsdom 里量不到高度，曲线区按最小高度排
const layout = curvePlotLayout(0);

const scalesOf = (objectIds: number[], list: ControlledObject[] = objects) =>
  fitCurveScales(
    buildAxisCurves({ resolved: resolveActionSequence(sequence), objectIds, axis: "v1", objects: list }),
  );

const renderCurves = (overrides: Partial<TimelineEditorProps> = {}) => {
  const onSelectionChange = vi.fn();
  const onCursorChange = vi.fn();
  const onPoseAxisDrag = vi.fn();
  const onPoseAxisDragEnd = vi.fn();
  render(
    <DisplayLengthUnitProvider initialUnit="mm">
      <TimelineEditor
        {...createTimelineProps(sequence, onSelectionChange)}
        objects={objects}
        onCursorChange={onCursorChange}
        onPoseAxisDrag={onPoseAxisDrag}
        onPoseAxisDragEnd={onPoseAxisDragEnd}
        viewMode="curves"
        curveAxis="v1"
        snapEnabled={false}
        {...overrides}
      />
    </DisplayLengthUnitProvider>,
  );
  return { onSelectionChange, onCursorChange, onPoseAxisDrag, onPoseAxisDragEnd };
};

const keyOf = (blockId: string): Element => {
  const key = document.querySelector(`[data-testid='curve-key'][data-block-id='${blockId}']`);
  if (!key) throw new Error(`missing key ${blockId}`);
  return key;
};

const keyCenter = (blockId: string) => {
  const hit = keyOf(blockId).querySelector("[data-testid='curve-key-hit']");
  return { x: Number(hit?.getAttribute("cx")), y: Number(hit?.getAttribute("cy")) };
};

const plot = () => screen.getByTestId("timeline-curve-plot");

/** createTimelineProps 是 100 px/s */
const xAt = (atMs: number) => TIMELINE_PAD_LEFT + atMs / 10;

let restorePaneWidth: (() => void) | undefined;
beforeEach(() => {
  restorePaneWidth = installTimelinePaneWidth();
});
afterEach(() => {
  restorePaneWidth?.();
  cleanup();
});

describe("curve view", () => {
  it("replaces the tracks with the position curves of the chosen axis", () => {
    renderCurves({ cursorMs: 2000 });
    expect(screen.queryByTestId("timeline-tracks")).toBeNull();
    expect(screen.getByTestId("timeline-curve-plot").getAttribute("data-graph")).toBe("position");
    expect(
      [...document.querySelectorAll("[data-testid='curve']")].map((item) => item.getAttribute("data-object-id")),
    ).toEqual(["7", "8"]);
    expect(screen.getByTestId("curve-graph-title").textContent).toBe("V1 位置 mm");
    expect(screen.getAllByTestId("curve-readout")[0]!.textContent).toBe("1000 mm");
    expect(keyOf("a2").getAttribute("data-kind")).toBe("set");
    expect(keyOf("b2").getAttribute("data-kind")).toBe("pass");
    expect(screen.queryAllByTestId("curve-junction")).toHaveLength(0);
  });

  it("shows the speed curves instead when switched to speed", () => {
    const { onSelectionChange, onPoseAxisDrag } = renderCurves({ curveGraph: "velocity", cursorMs: 2000 });
    expect(screen.getByTestId("timeline-curve-plot").getAttribute("data-graph")).toBe("velocity");
    expect(screen.getByTestId("curve-graph-title").textContent).toBe("V1 速度 mm/s");
    // 2 s 处 a2 经过：前后平均速度都是 500，调和平均 500
    expect(screen.getAllByTestId("curve-readout")[0]!.textContent).toBe("500 mm/s");
    expect(screen.queryAllByTestId("curve-key")).toHaveLength(0);
    const junction = document.querySelector("[data-testid='curve-junction'][data-block-id='a2']")!;
    expect(junction.getAttribute("data-kind")).toBe("auto");

    // 速度图只看不拖：点速度点选中位姿，拖也不改值
    const hit = junction.querySelector("[data-testid='curve-key-hit']")!;
    const x = Number(hit.getAttribute("cx"));
    const y = Number(hit.getAttribute("cy"));
    fireEvent.pointerDown(junction, { clientX: x, clientY: y, button: 0 });
    fireEvent.pointerMove(window, { clientX: x, clientY: y + 30 });
    fireEvent.pointerUp(window, { clientX: x, clientY: y + 30 });
    expect(onPoseAxisDrag).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "block", blockId: "a2" });
  });

  it("only draws the selected objects, and only objects the sequence moves on that axis", () => {
    renderCurves({ selectedObjectIds: [8] });
    expect(
      [...document.querySelectorAll("[data-testid='curve']")].map((item) => item.getAttribute("data-object-id")),
    ).toEqual(["8"]);
    cleanup();

    renderCurves({ curveAxis: "v2" });
    expect(
      [...document.querySelectorAll("[data-testid='curve']")].map((item) => item.getAttribute("data-object-id")),
    ).toEqual(["8"]);
    expect(screen.getAllByTestId("curve-readout")).toHaveLength(1);
  });

  it("selects a pose by clicking its key and toggles it with Ctrl/⌘", () => {
    const first = renderCurves();
    const { x, y } = keyCenter("a2");
    fireEvent.pointerDown(keyOf("a2"), { clientX: x, clientY: y, button: 0 });
    fireEvent.pointerUp(window, { clientX: x, clientY: y });
    expect(first.onSelectionChange).toHaveBeenCalledWith({ kind: "block", blockId: "a2" });
    expect(first.onPoseAxisDrag).not.toHaveBeenCalled();
    cleanup();

    const second = renderCurves({ selection: { kind: "block", blockId: "a1" } });
    fireEvent.pointerDown(keyOf("a2"), { clientX: x, clientY: y, button: 0, ctrlKey: true });
    fireEvent.pointerUp(window, { clientX: x, clientY: y });
    expect(second.onSelectionChange).toHaveBeenCalledWith({
      kind: "multi-block",
      blockIds: ["a1", "a2"],
    });
  });

  it("drags a key up and down to change only its value", () => {
    const { onSelectionChange, onPoseAxisDrag, onPoseAxisDragEnd } = renderCurves();
    const { x, y } = keyCenter("a2");
    const scales = scalesOf([7, 8]);
    const step = dragValueStep((scales.position.max - scales.position.min) / layout.plot.height);
    const expected = roundDragValue(plotValue(layout.plot, scales.position, y + 20), step) - 1000;

    fireEvent.pointerDown(keyOf("a2"), { clientX: x, clientY: y, button: 0 });
    fireEvent.pointerMove(window, { clientX: x + 40, clientY: y + 20 });
    fireEvent.pointerUp(window, { clientX: x + 40, clientY: y + 20 });

    expect(expected).toBeLessThan(0);
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "block", blockId: "a2" });
    expect(onPoseAxisDrag).toHaveBeenLastCalledWith(["a2"], "v1", expected);
    expect(onPoseAxisDragEnd).toHaveBeenCalledTimes(1);
  });

  it("moves every selected pose by the same amount when the dragged key is selected", () => {
    const { onSelectionChange, onPoseAxisDrag } = renderCurves({
      selection: { kind: "multi-block", blockIds: ["a2", "b3"] },
    });
    const { x, y } = keyCenter("a2");
    fireEvent.pointerDown(keyOf("a2"), { clientX: x, clientY: y, button: 0 });
    fireEvent.pointerMove(window, { clientX: x, clientY: y - 15 });
    fireEvent.pointerUp(window, { clientX: x, clientY: y - 15 });

    expect(onSelectionChange).not.toHaveBeenCalled();
    const [ids, axis, delta] = onPoseAxisDrag.mock.lastCall ?? [];
    expect(ids).toEqual(["a2", "b3"]);
    expect(axis).toBe("v1");
    expect(delta).toBeGreaterThan(0);
  });

  it("snaps to another key's value unless Alt is held", () => {
    const scales = scalesOf([7, 8]);
    const nearB3 = plotY(layout.plot, scales.position, 1500) + 2;
    const snapped = renderCurves({ snapEnabled: true });
    const { x, y } = keyCenter("a2");
    fireEvent.pointerDown(keyOf("a2"), { clientX: x, clientY: y, button: 0 });
    fireEvent.pointerMove(window, { clientX: x, clientY: nearB3 });
    expect(screen.getByTestId("curve-snap-line")).toBeTruthy();
    fireEvent.pointerUp(window, { clientX: x, clientY: nearB3 });
    expect(snapped.onPoseAxisDrag).toHaveBeenLastCalledWith(["a2"], "v1", 500);
    cleanup();

    const free = renderCurves({ snapEnabled: true });
    fireEvent.pointerDown(keyOf("a2"), { clientX: x, clientY: y, button: 0 });
    fireEvent.pointerMove(window, { clientX: x, clientY: nearB3, altKey: true });
    fireEvent.pointerUp(window, { clientX: x, clientY: nearB3 });
    expect(free.onPoseAxisDrag.mock.lastCall?.[2]).not.toBe(500);
  });

  it("does not drag a point the pose leaves unset", () => {
    const { onSelectionChange, onPoseAxisDrag } = renderCurves();
    const { x, y } = keyCenter("b2");
    fireEvent.pointerDown(keyOf("b2"), { clientX: x, clientY: y, button: 0 });
    fireEvent.pointerMove(window, { clientX: x, clientY: y + 30 });
    fireEvent.pointerUp(window, { clientX: x, clientY: y + 30 });
    expect(onPoseAxisDrag).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "block", blockId: "b2" });
  });

  it("moves the playhead and clears the selection on an empty spot", () => {
    const { onSelectionChange, onCursorChange } = renderCurves({
      selection: { kind: "block", blockId: "a1" },
    });
    // 5 s 处两条曲线都在 1500 以上，位置图中间是空的
    const y = layout.plot.top + layout.plot.height / 2;
    fireEvent.pointerDown(plot(), { clientX: xAt(5000), clientY: y, button: 0 });
    fireEvent.pointerUp(window, { clientX: xAt(5000), clientY: y });
    expect(onCursorChange).toHaveBeenCalledWith(5000);
    expect(onSelectionChange).toHaveBeenCalledWith(null);
  });

  it("selects the motion segment under a click on the curve", () => {
    const { onSelectionChange, onCursorChange } = renderCurves({ selectedObjectIds: [7] });
    const [curve] = buildAxisCurves({
      resolved: resolveActionSequence(sequence),
      objectIds: [7],
      axis: "v1",
      objects,
    });
    const scales = fitCurveScales([curve!]);
    const y7 = plotY(layout.plot, scales.position, curveSampleAt(curve!, 3000).value);

    fireEvent.pointerDown(plot(), { clientX: xAt(3000), clientY: y7, button: 0 });
    fireEvent.pointerUp(window, { clientX: xAt(3000), clientY: y7 });
    expect(onCursorChange).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledWith({
      kind: "multi-block",
      blockIds: ["a2", "a3"],
      focus: "segments",
    });
  });

  it("box-selects the keys inside the dragged box", () => {
    const { onSelectionChange } = renderCurves();
    fireEvent.pointerDown(plot(), { clientX: xAt(1500), clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: xAt(3500), clientY: layout.height });
    fireEvent.pointerUp(window, { clientX: xAt(3500), clientY: layout.height });
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "multi-block", blockIds: ["a2", "b3"] });
    cleanup();

    // 速度图框的是位姿处的速度点
    const speed = renderCurves({ curveGraph: "velocity" });
    fireEvent.pointerDown(plot(), { clientX: xAt(1500), clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: xAt(3500), clientY: layout.height });
    fireEvent.pointerUp(window, { clientX: xAt(3500), clientY: layout.height });
    expect(speed.onSelectionChange).toHaveBeenCalledWith({ kind: "multi-block", blockIds: ["a2", "b3"] });
  });

  it("thickens the curves of the objects owning the selection instead of relying on hover", () => {
    renderCurves({ selection: { kind: "block", blockId: "a2" } });
    const curveOf = (objectId: string) =>
      document.querySelector(`[data-testid='curve'][data-object-id='${objectId}']`)!;
    expect(curveOf("7").getAttribute("opacity")).toBe("1");
    expect(curveOf("7").querySelector("path")?.getAttribute("stroke-width")).toBe("2.5");
    expect(curveOf("8").getAttribute("opacity")).toBe("0.3");
    expect(screen.getAllByTestId("curve-emphasis-dot")).toHaveLength(1);
    const list = within(screen.getByTestId("curve-object-list"));
    expect(within(list.getByRole("button", { name: /升降台 7/ })).getByTestId("curve-emphasis-dot")).toBeTruthy();
    cleanup();

    renderCurves();
    expect(screen.queryAllByTestId("curve-emphasis-dot")).toHaveLength(0);
    expect(
      [...document.querySelectorAll("[data-testid='curve']")].map((item) => item.getAttribute("opacity")),
    ).toEqual(["1", "1"]);
  });

  it("finishes a drag the system interrupts and ignores an interrupted tap", () => {
    const dragged = renderCurves();
    const { x, y } = keyCenter("a2");
    fireEvent.pointerDown(keyOf("a2"), { clientX: x, clientY: y, button: 0 });
    fireEvent.pointerMove(window, { clientX: x, clientY: y + 20 });
    fireEvent.pointerCancel(window);
    expect(dragged.onPoseAxisDrag).toHaveBeenCalled();
    expect(dragged.onPoseAxisDragEnd).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(window, { clientX: x, clientY: y + 40 });
    expect(dragged.onPoseAxisDrag).toHaveBeenCalledTimes(1);
    cleanup();

    const tapped = renderCurves();
    fireEvent.pointerDown(keyOf("a2"), { clientX: x, clientY: y, button: 0 });
    fireEvent.pointerCancel(window);
    expect(tapped.onSelectionChange).not.toHaveBeenCalled();
    expect(tapped.onPoseAxisDragEnd).not.toHaveBeenCalled();
  });

  it("uses larger touch targets on a touch screen", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      renderCurves();
      expect(keyOf("a2").querySelector("[data-testid='curve-key-hit']")?.getAttribute("r")).toBe("16");
      expect(screen.getByTestId("timeline-curve-plot").getAttribute("class")).toContain("touch-none");
    } finally {
      window.matchMedia = original;
    }
  });

  it("marks spans that break the object's limits in both graphs", () => {
    const slow = [objectOf(7, "升降台 7", 300), objectOf(8, "吊杆 8")];
    renderCurves({ objects: slow });
    const labels = () => screen.getAllByTestId("curve-issue-label").map((item) => item.textContent);
    expect(labels().some((text) => text?.startsWith("超速"))).toBe(true);
    cleanup();

    renderCurves({ objects: slow, curveGraph: "velocity" });
    expect(labels().some((text) => text?.startsWith("超速"))).toBe(true);
    expect(screen.getAllByTestId("curve-speed-limit").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("curve-tick-speed-limit").map((item) => item.textContent)).toContain("300");
  });
});

describe("timeline toolbar view menu", () => {
  const renderToolbar = (overrides: Partial<Parameters<typeof TimelineToolbar>[0]> = {}) => {
    const onViewModeChange = vi.fn();
    const onCurveGraphChange = vi.fn();
    const onCurveAxisChange = vi.fn();
    render(
      <TimelineToolbar
        majorStepSec={1}
        canZoomIn
        canZoomOut
        canDelete
        viewMode="curves"
        onViewModeChange={onViewModeChange}
        curveGraph="position"
        onCurveGraphChange={onCurveGraphChange}
        curveAxis="v1"
        curveAxes={[
          { axis: "v1", available: true },
          { axis: "v2", available: true },
          { axis: "v3", available: false },
        ]}
        onCurveAxisChange={onCurveAxisChange}
        {...overrides}
      />,
    );
    return { onViewModeChange, onCurveGraphChange, onCurveAxisChange };
  };

  const openViewMenu = async () => {
    fireEvent.pointerDown(screen.getByRole("button", { name: "视图" }), { button: 0, ctrlKey: false });
    await screen.findByRole("menu");
  };

  it("puts the curve switch, the graph and the axis in the view menu", async () => {
    const { onViewModeChange, onCurveGraphChange, onCurveAxisChange } = renderToolbar();
    expect(screen.queryByRole("radio")).toBeNull();
    await openViewMenu();

    const showCurves = screen.getByRole("menuitemcheckbox", { name: "显示曲线" });
    expect(showCurves.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "位置" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "V1" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: /V3/ }).getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "速度" }));
    expect(onCurveGraphChange).toHaveBeenCalledWith("velocity");
    // 切完菜单不关，可以接着设
    fireEvent.click(screen.getByRole("menuitemradio", { name: "V2" }));
    expect(onCurveAxisChange).toHaveBeenCalledWith("v2");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "显示曲线" }));
    expect(onViewModeChange).toHaveBeenCalledWith("tracks");
  });

  it("greys out the curve options while the tracks are shown", async () => {
    const { onViewModeChange } = renderToolbar({ viewMode: "tracks" });
    await openViewMenu();
    expect(screen.getByRole("menuitemcheckbox", { name: "显示曲线" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("menuitemradio", { name: "速度" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "V2" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "显示曲线" }));
    expect(onViewModeChange).toHaveBeenCalledWith("curves");
  });
});
