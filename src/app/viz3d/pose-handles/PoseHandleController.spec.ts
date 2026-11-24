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

const target = (objectId: string, overrides: Partial<PoseHandleTarget> = {}): PoseHandleTarget => ({
  objectId,
  kinds: objectId === "r" ? ["yaw"] : ["lift"],
  values: { v1: 0, v2: 0, v3: 0 },
  ...overrides,
});

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

  it("draws a handle per target and kind", () => {
    setup([target("a"), target("r")]);
    expect([...slot.querySelectorAll("[data-handle]")].map((node) => (node as SVGGElement).dataset.handle)).toEqual([
      "a:lift",
      "r:yaw",
    ]);
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
