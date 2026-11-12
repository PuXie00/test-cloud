import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Vec3 } from "../types";
import { MeasureTool, type MeasurePointResolver } from "./MeasureTool";
import type { MeasureRuler, ProjectedRuler } from "./measure-rulers";

/** 假格子：屏幕 1px = 世界 0.01m，落在地面 y=0；x≥500 一带是「吊点」 */
const toWorld = (x: number, y: number): Vec3 => ({ x: x / 100, y: 0, z: y / 100 });
const toScreen = (point: Vec3) => ({ x: point.x * 100, y: point.z * 100 });

const createTool = () => {
  const onChange = vi.fn();
  const resolvePoint = vi.fn<MeasurePointResolver>((x, y, _cell, options) =>
    x >= 500
      ? { point: { x: 5, y: 2, z: 0 }, snap: "hoist" }
      : { point: toWorld(x, y), snap: options.snapVertices ? "vertex" : "ground" },
  );
  const project = (rulers: readonly MeasureRuler[]): ProjectedRuler[] =>
    rulers.map((ruler) => ({
      id: ruler.id,
      a: toScreen(ruler.a),
      b: toScreen(ruler.b),
      aInFront: true,
      bInFront: true,
    }));
  const tool = new MeasureTool(resolvePoint, project, onChange);
  return { tool, onChange, resolvePoint };
};

const down = (tool: MeasureTool, x: number, y: number, extra: { pointerId?: number; toggleSnap?: boolean } = {}) =>
  tool.pointerDown({ x, y, pointerId: extra.pointerId ?? 1, toggleSnap: extra.toggleSnap ?? false, cellId: "main", coarse: false });
const move = (tool: MeasureTool, x: number, y: number, pointerId = 1) =>
  tool.pointerMove({ x, y, pointerId, toggleSnap: false });
const up = (tool: MeasureTool, x: number, y: number, pointerId = 1) =>
  tool.pointerUp({ x, y, pointerId, toggleSnap: false });

const drawRuler = (tool: MeasureTool, from: [number, number], to: [number, number]) => {
  down(tool, ...from);
  move(tool, ...to);
  up(tool, ...to);
};

describe("MeasureTool", () => {
  let tool: MeasureTool;
  let resolvePoint: ReturnType<typeof createTool>["resolvePoint"];

  beforeEach(() => {
    ({ tool, resolvePoint } = createTool());
  });

  it("drags out a ruler and selects it", () => {
    drawRuler(tool, [0, 0], [300, 400]);
    const state = tool.getState();
    expect(state.rulers).toHaveLength(1);
    expect(state.rulers[0]!.lengthMm).toBeCloseTo(5000);
    expect(state.rulers[0]!.deltaMm).toEqual({ x: 3000, y: 0, z: 4000 });
    expect(state.selectedId).toBe(state.rulers[0]!.id);
  });

  it("does not create a ruler for a click, and a click on empty space deselects", () => {
    drawRuler(tool, [0, 0], [300, 0]);
    down(tool, 100, 300);
    up(tool, 102, 301);
    expect(tool.getState()).toMatchObject({ selectedId: null });
    expect(tool.getRulers()).toHaveLength(1);
  });

  it("selects a ruler by clicking its line", () => {
    drawRuler(tool, [0, 0], [300, 0]);
    tool.select(null);
    down(tool, 150, 3);
    up(tool, 150, 3);
    expect(tool.getSelectedId()).toBe(tool.getRulers()[0]!.id);
  });

  it("moves the grabbed endpoint and snaps it", () => {
    drawRuler(tool, [0, 0], [300, 0]);
    down(tool, 302, 2);
    move(tool, 600, 0);
    expect(tool.getDragSnap()).toMatchObject({ endpoint: "b", kind: "hoist" });
    up(tool, 600, 0);
    expect(tool.getRulers()[0]!.b).toEqual({ x: 5, y: 2, z: 0 });
    expect(tool.getDragSnap()).toBeNull();
  });

  it("leaves the endpoint alone on a tap", () => {
    drawRuler(tool, [0, 0], [300, 0]);
    down(tool, 302, 2);
    up(tool, 303, 2);
    expect(tool.getRulers()[0]!.b).toEqual({ x: 3, y: 0, z: 0 });
  });

  it("toggles vertex snapping with Ctrl, relative to the switch", () => {
    down(tool, 0, 0, { toggleSnap: true });
    expect(resolvePoint).toHaveBeenLastCalledWith(0, 0, "main", { snapVertices: true, coarse: false });
    up(tool, 0, 0);
    tool.setSnapVertices(true);
    down(tool, 0, 0, { toggleSnap: true });
    expect(resolvePoint).toHaveBeenLastCalledWith(0, 0, "main", { snapVertices: false, coarse: false });
  });

  it("drops a zero-length ruler and restores the selection", () => {
    drawRuler(tool, [0, 0], [300, 0]);
    const first = tool.getSelectedId();
    drawRuler(tool, [600, 0], [700, 0]);
    expect(tool.getRulers()).toHaveLength(1);
    expect(tool.getSelectedId()).toBe(first);
  });

  it("puts an endpoint back when the move would collapse the ruler", () => {
    drawRuler(tool, [600, 0], [100, 0]);
    down(tool, 100, 0);
    move(tool, 650, 0);
    up(tool, 650, 0);
    expect(tool.getRulers()[0]!.b).toEqual({ x: 1, y: 0, z: 0 });
  });

  it("cancels a drag: a new ruler disappears, a moved endpoint goes back", () => {
    down(tool, 0, 0);
    move(tool, 300, 0);
    expect(tool.cancelDrag()).toBe(true);
    expect(tool.getRulers()).toHaveLength(0);

    drawRuler(tool, [0, 0], [300, 0]);
    down(tool, 300, 0);
    move(tool, 300, 200);
    tool.cancelDrag();
    expect(tool.getRulers()[0]!.b).toEqual({ x: 3, y: 0, z: 0 });
    expect(tool.cancelDrag()).toBe(false);
  });

  it("gives way to a second finger", () => {
    down(tool, 0, 0, { pointerId: 1 });
    move(tool, 300, 0, 1);
    expect(down(tool, 200, 200, { pointerId: 2 })).toBe(false);
    expect(tool.getRulers()).toHaveLength(0);
    expect(tool.isDragging()).toBe(false);
  });

  it("deletes the selected ruler and clears everything", () => {
    drawRuler(tool, [0, 0], [300, 0]);
    drawRuler(tool, [0, 100], [300, 100]);
    expect(tool.deleteSelected()).toBe(true);
    expect(tool.getRulers()).toHaveLength(1);
    expect(tool.deleteSelected()).toBe(false);
    tool.clear();
    expect(tool.getState()).toEqual({ rulers: [], selectedId: null, snapVertices: false });
  });
});
