// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneObjectConfig } from "../types";
import { PoseHandleController, type PoseHandleHost } from "./PoseHandleController";
import { PoseHandleOverlay } from "./PoseHandleOverlay";
import type { Pt } from "./pose-handle-math";
import type { PoseHandleTarget } from "./pose-handle-types";
import { FRONT_VIEW, testObject } from "./pose-handle-test-utils";

const configs = new Map<string, SceneObjectConfig>([
  ["a", testObject("singlePointMove", { runDirection: 2 }, { id: "a" })],
  ["b", testObject("singlePointMove", {}, { id: "b", position: { x: 3, y: 3, z: 0 } })],
  ["r", testObject("singlePointRotation", {}, { id: "r", position: { x: -3, y: 3, z: 0 } })],
  ["t", testObject("dualTiltFourPointSwing", {}, { id: "t", position: { x: 2, y: 3, z: 0 } })],
]);

const makeHost = () => {
  const { projector, rayAt } = FRONT_VIEW();
  const host = {
    getCells: () => [{ id: "main" as const, rect: { left: 0, top: -400, width: 800, height: 1200 }, projector, rayAt }],
    getConfig: (id: string) => configs.get(id),
    getParentWorld: () => null,
    getSnapCandidates: () => [],
    setOrbitEnabled: vi.fn(),
    setCursor: vi.fn(),
    onDragStart: vi.fn(),
    onDrag: vi.fn(),
    onDragEnd: vi.fn(),
    onBlocked: vi.fn(),
  } satisfies PoseHandleHost;
  return { host, projector };
};

const KINDS: Record<string, PoseHandleTarget["kinds"]> = { r: ["yaw"], t: ["lift", "tiltX", "tiltY"] };

const target = (objectId: string, overrides: Partial<PoseHandleTarget> = {}): PoseHandleTarget => ({
  objectId,
  kinds: KINDS[objectId] ?? ["lift"],
  values: { v1: 0, v2: 0, v3: 0 },
  axisLabels: objectId === "t" ? { v1: "升降", v2: "摆动 X", v3: "摆动 Y" } : undefined,
  ...overrides,
});

const handleKeys = (slot: HTMLElement) =>
  [...slot.querySelectorAll("[data-handle]")].map((node) => (node as SVGGElement).dataset.handle);

describe("PoseHandleController", () => {
  let slot: HTMLDivElement;

  beforeEach(() => {
    slot = document.createElement("div");
    document.body.appendChild(slot);
  });

  afterEach(() => {
    slot.remove();
  });

  const setup = (targets: PoseHandleTarget[]) => {
    const { host, projector } = makeHost();
    const controller = new PoseHandleController(host, new PoseHandleOverlay(slot));
    controller.setTargets(targets);
    controller.render();
    // 升降箭头在顶面中心上方 26..84 px
    const anchor = projector.project({ x: 0, y: 3.2, z: 0 })!;
    const arrow: Pt = { x: anchor.x, y: anchor.y - 50 };
    return { host, controller, arrow };
  };

  it("draws one handle per object", () => {
    setup([target("a"), target("r"), target("t")]);
    expect(handleKeys(slot)).toEqual(["a:lift", "r:yaw", "t:lift"]);
  });

  it("switches every object to the chosen axis, keeping the first handle where it has none", () => {
    const { controller } = setup([target("a"), target("t")]);
    expect(controller.setActiveAxis("v3")).toBe(true);
    controller.render();
    expect(handleKeys(slot)).toEqual(["a:lift", "t:tiltY"]);
    expect(controller.getActiveAxis()).toBe("v3");
  });

  it("won't switch to an axis no handle has", () => {
    const { controller } = setup([target("a"), target("r")]);
    expect(controller.setActiveAxis("v2")).toBe(false);
    expect(controller.getActiveAxis()).toBe("v1");
  });

  it("lists the axes beside the handle and switches on click", () => {
    const { controller } = setup([target("a"), target("t")]);
    const chips = [...slot.querySelectorAll<HTMLDivElement>('[data-testid="pose-handle-switch"]')];
    expect(chips.map((chip) => [chip.textContent, chip.dataset.active])).toEqual([
      ["1 升降", "true"],
      ["2 摆动 X", "false"],
      ["3 摆动 Y", "false"],
    ]);
    // 切换条在画布坐标里：格子的 top 是 -400
    const chip = chips[1]!;
    const point = {
      x: parseFloat(chip.style.left) + parseFloat(chip.style.width) / 2,
      y: parseFloat(chip.style.top) - 400 + parseFloat(chip.style.height) / 2,
    };
    expect(controller.pointerDown(point, 1)).toBe(true);
    controller.pointerUp(1);
    controller.render();
    expect(handleKeys(slot)).toEqual(["a:lift", "t:tiltX"]);
  });

  it("drags only the objects showing the same handle", () => {
    const { host, controller, arrow } = setup([target("a"), target("t")]);
    controller.setActiveAxis("v2");
    controller.render();
    controller.pointerDown(arrow, 1);
    controller.pointerMove({ x: arrow.x, y: arrow.y - 30 }, 1, false);
    expect(host.onDragStart).toHaveBeenCalledWith({ kind: "lift", objectId: "a", objectIds: ["a"] });
    controller.pointerUp(1);
  });

  it("drags only after the pointer moves, and moves the same kind of handles together", () => {
    const { host, controller, arrow } = setup([target("a"), target("b", { values: { v1: 800 } }), target("r")]);
    expect(controller.pointerDown(arrow, 1)).toBe(true);
    controller.pointerMove({ x: arrow.x, y: arrow.y - 2 }, 1, false);
    expect(host.onDragStart).not.toHaveBeenCalled();

    controller.pointerMove({ x: arrow.x, y: arrow.y - 30 }, 1, false);
    expect(host.onDragStart).toHaveBeenCalledWith({ kind: "lift", objectId: "a", objectIds: ["a", "b"] });
    expect(host.setOrbitEnabled).toHaveBeenLastCalledWith(false);
    const drag = host.onDrag.mock.calls.at(-1)![0];
    expect(drag.updates.map((update: { objectId: string }) => update.objectId)).toEqual(["a", "b"]);
    expect(drag.updates[0].values.v1).toBeCloseTo(300, 0);
    expect(drag.updates[1].values.v1).toBeCloseTo(500, 0);

    controller.render();
    expect(slot.querySelector('[data-testid="pose-handle-value"]')?.textContent).toContain("v1 300.0 (+300.0)");

    expect(controller.pointerUp(1)).toBe(true);
    expect(host.onDragEnd).toHaveBeenCalledWith({ cancelled: false });
    expect(host.setOrbitEnabled).toHaveBeenLastCalledWith(true);
  });

  it("cancels with Escape", () => {
    const { host, controller, arrow } = setup([target("a")]);
    controller.pointerDown(arrow, 1);
    controller.pointerMove({ x: arrow.x, y: arrow.y - 30 }, 1, false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(host.onDragEnd).toHaveBeenCalledWith({ cancelled: true });
    expect(controller.isDragging()).toBe(false);
  });

  it("reports why a blocked handle can't be dragged instead of starting a box select", () => {
    const { host, controller, arrow } = setup([target("a", { blockedReason: "游标在预设里：先拆开再拖" })]);
    expect(controller.pointerDown(arrow, 1)).toBe(true);
    expect(host.onBlocked).toHaveBeenCalledWith({ objectId: "a", reason: "游标在预设里：先拆开再拖" });
    controller.pointerMove({ x: arrow.x, y: arrow.y - 30 }, 1, false);
    expect(host.onDragStart).not.toHaveBeenCalled();
  });

  it("marks the handle when the drag runs past the travel limit", () => {
    const { controller, arrow } = setup([target("a", { ranges: { v1: { min: 0, max: 200 } } })]);
    controller.pointerDown(arrow, 1);
    controller.pointerMove({ x: arrow.x, y: arrow.y - 30 }, 1, false);
    controller.render();
    const label = slot.querySelector('[data-testid="pose-handle-value"]');
    expect(label?.textContent).toContain("v1 200.0 (+200.0)");
    expect(label?.textContent).toContain("已到行程上限");
  });

  it("leaves clicks away from handles to box select", () => {
    const { controller, arrow } = setup([target("a")]);
    expect(controller.pointerDown({ x: arrow.x + 60, y: arrow.y }, 1)).toBe(false);
  });

  it("stops when the editor refuses the drag at start", () => {
    const { host, controller, arrow } = setup([target("a")]);
    host.onDragStart.mockImplementation(() => controller.cancel());
    controller.pointerDown(arrow, 1);
    controller.pointerMove({ x: arrow.x, y: arrow.y - 30 }, 1, false);
    expect(host.onDrag).not.toHaveBeenCalled();
    expect(host.onDragEnd).toHaveBeenCalledWith({ cancelled: true });
  });
});
