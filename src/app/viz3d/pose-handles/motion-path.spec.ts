// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneObjectConfig } from "../types";
import { motionPathWorld } from "./motion-path-geometry";
import { hitTestMotionPaths, layoutMotionPath } from "./motion-path-layout";
import type { MotionPathEntry } from "./motion-path-types";
import { parseMotionPathMode } from "./motion-path-types";
import { MotionPathOverlay } from "./MotionPathOverlay";
import { PoseHandleController, type PoseHandleHost } from "./PoseHandleController";
import { PoseHandleOverlay } from "./PoseHandleOverlay";
import { FRONT_VIEW, testObject, TOP_VIEW } from "./pose-handle-test-utils";

const lift = testObject("singlePointMove", { runDirection: 2 }, { id: "a" });
const turntable = testObject("singlePointRotation", {}, { id: "r", position: { x: -3, y: 3, z: 0 } });

/** 0→2 s 从 0 升到 1000 mm，再到 4 s 回到 0 */
const liftEntry = (overrides: Partial<MotionPathEntry> = {}): MotionPathEntry => ({
  objectId: "a",
  selected: true,
  samples: [0, 1000, 2000, 3000, 4000].map((atMs) => ({
    atMs,
    values: { v1: atMs <= 2000 ? atMs / 2 : (4000 - atMs) / 2 },
  })),
  keyframes: [
    { atMs: 0, values: { v1: 0 }, blockId: "p0", selected: false, invalid: false },
    { atMs: 2000, values: { v1: 1000 }, blockId: "p1", selected: true, invalid: false },
    { atMs: 4000, values: { v1: 0 }, blockId: "p2", selected: false, invalid: false },
  ],
  cursor: { atMs: 1000, values: { v1: 500 } },
  issues: [],
  ...overrides,
});

describe("parseMotionPathMode", () => {
  it("keeps known modes and defaults to selected", () => {
    expect(parseMotionPathMode("all")).toBe("all");
    expect(parseMotionPathMode("off")).toBe("off");
    expect(parseMotionPathMode("garbage")).toBe("selected");
  });
});

describe("motionPathWorld", () => {
  it("traces the top center of a hoist up and down", () => {
    const world = motionPathWorld(liftEntry({ issueAtCursor: true }), lift, () => null)!;
    expect(world.style).toBe("path");
    expect(world.points.map(({ point }) => point.y)).toEqual([3.2, 3.7, 4.2, 3.7, 3.2].map((y) => expect.closeTo(y, 4)));
    expect(world.cursorPoint!.y).toBeCloseTo(3.7, 4);
    // 只有标红的框，不画前后位姿
    expect(world.outlines.map((outline) => outline.kind)).toEqual(["issue"]);
    expect(world.outlines[0]!.corners).toHaveLength(8);
  });

  it("puts rotation poses as ticks on the ring, relative to the heading at the cursor", () => {
    const world = motionPathWorld(
      {
        objectId: "r",
        selected: true,
        samples: [],
        keyframes: [
          { atMs: 0, values: { v1: 0 }, blockId: "k0", selected: false, invalid: false },
          { atMs: 1000, values: { v1: 30 }, blockId: "k1", selected: false, invalid: false },
        ],
        cursor: { atMs: 0, values: { v1: 0 } },
        issues: [],
      },
      turntable,
      () => null,
    )!;
    expect(world.style).toBe("ring");
    expect(world.keyframes[0]!.angle).toBeCloseTo(0, 6);
    expect(Math.abs(world.keyframes[1]!.angle!)).toBeCloseTo(Math.PI / 6, 4);
  });
});

describe("hitTestMotionPaths", () => {
  const { projector } = FRONT_VIEW();
  const layout = (entry: MotionPathEntry) =>
    layoutMotionPath(motionPathWorld(entry, lift, () => null)!, projector);

  it("picks a pose dot and gives its block", () => {
    const dot = projector.project({ x: 0, y: 4.2, z: 0 })!;
    expect(hitTestMotionPaths([layout(liftEntry())], { x: dot.x + 2, y: dot.y })).toMatchObject({
      kind: "keyframe",
      blockId: "p1",
      atMs: 2000,
    });
  });

  it("works out the moment on the line between samples", () => {
    // 正面看时上去和下来重叠：取先命中的（同样近）那段
    const at = projector.project({ x: 0, y: 3.45, z: 0 })!;
    const hit = hitTestMotionPaths([layout(liftEntry({ keyframes: [] }))], at);
    expect(hit?.kind).toBe("time");
    expect(hit?.atMs).toBeCloseTo(500, 0);
  });

  it("marks the problem part of the line", () => {
    const at = projector.project({ x: 0, y: 3.45, z: 0 })!;
    const hit = hitTestMotionPaths(
      [layout(liftEntry({ keyframes: [], issues: [{ fromMs: 0, toMs: 2000, segmentKey: "seg-up" }] }))],
      at,
    );
    expect(hit).toMatchObject({ kind: "time", segmentKey: "seg-up" });
  });

  it("only lets the line of a selected object be clicked; dots always", () => {
    const at = projector.project({ x: 0, y: 3.45, z: 0 })!;
    expect(hitTestMotionPaths([layout(liftEntry({ selected: false, keyframes: [] }))], at)).toBeNull();
    const dot = projector.project({ x: 0, y: 3.2, z: 0 })!;
    expect(hitTestMotionPaths([layout(liftEntry({ selected: false }))], dot)?.kind).toBe("keyframe");
  });
});

describe("PoseHandleController with motion paths", () => {
  let slot: HTMLDivElement;

  beforeEach(() => {
    slot = document.createElement("div");
    document.body.appendChild(slot);
  });

  afterEach(() => {
    slot.remove();
  });

  const setup = (view = FRONT_VIEW()) => {
    const { projector, rayAt } = view;
    const host = {
      getCells: () => [{ id: "main" as const, rect: { left: 0, top: -400, width: 800, height: 1200 }, projector, rayAt }],
      getConfig: (id: string): SceneObjectConfig | undefined => (id === "a" ? lift : undefined),
      getParentWorld: () => null,
      getSnapCandidates: () => [],
      setOrbitEnabled: vi.fn(),
      setCursor: vi.fn(),
      onDragStart: vi.fn(),
      onDrag: vi.fn(),
      onDragEnd: vi.fn(),
      onBlocked: vi.fn(),
      onPathPick: vi.fn(),
    } satisfies PoseHandleHost;
    const controller = new PoseHandleController(host, new PoseHandleOverlay(slot), new MotionPathOverlay(slot));
    controller.setMotionPaths([liftEntry()]);
    controller.render();
    return { host, controller, projector };
  };

  it("draws the path, its dots and the cursor point", () => {
    setup();
    const group = slot.querySelector('[data-motion-path="a"]');
    expect(group).not.toBeNull();
    // 路径顺序：红框、环、描边、轨迹线……
    expect(group!.querySelectorAll("path")[3]!.getAttribute("d")).toMatch(/^M/);
  });

  it("clicking a pose dot picks that pose", () => {
    const { host, controller, projector } = setup();
    const dot = projector.project({ x: 0, y: 4.2, z: 0 })!;
    expect(controller.pointerDown(dot, 1)).toBe(true);
    controller.pointerUp(1);
    expect(host.onPathPick).toHaveBeenCalledWith({ kind: "keyframe", objectId: "a", blockId: "p1", atMs: 2000 });
  });

  it("a press that wanders off is not a click", () => {
    const { host, controller, projector } = setup();
    const dot = projector.project({ x: 0, y: 4.2, z: 0 })!;
    controller.pointerDown(dot, 1);
    controller.pointerMove({ x: dot.x + 10, y: dot.y }, 1, false);
    controller.pointerUp(1);
    expect(host.onPathPick).not.toHaveBeenCalled();
  });

  it("shows the moment under the pointer and a pointer cursor", () => {
    const { host, controller, projector } = setup();
    const at = projector.project({ x: 0, y: 3.45, z: 0 })!;
    controller.pointerMove(at, 1, false);
    controller.render();
    expect(host.setCursor).toHaveBeenLastCalledWith("pointer");
    expect(slot.querySelector('[data-testid="motion-path-hover"]')?.textContent).toBe("0.5 s");
  });

  it("lets presses away from the path through to box select", () => {
    const { controller, projector } = setup();
    const away = projector.project({ x: 2, y: 3.45, z: 0 })!;
    expect(controller.pointerDown(away, 1)).toBe(false);
  });

  it("hides the paths when there are none", () => {
    const { controller } = setup(TOP_VIEW());
    controller.setMotionPaths([]);
    controller.render();
    expect(slot.querySelector('[data-motion-path="a"]')).toBeNull();
  });
});
