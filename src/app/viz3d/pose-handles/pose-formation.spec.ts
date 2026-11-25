// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import type { SceneObjectConfig } from "../types";
import { motionRangeOf } from "./motion-path-geometry";
import type { DragMember, SnapCandidate } from "./pose-handle-drag";
import { toFullAxisValues } from "./pose-handle-kinematics";
import { formationHeightOf, formationSpread, solveFormation, solveLiftForHeight } from "./pose-formation";
import { PoseHandleController, type PoseHandleHost } from "./PoseHandleController";
import { FRONT_VIEW, testObject } from "./pose-handle-test-utils";
import type { PoseHandleTarget } from "./pose-handle-types";

/** 吊杆：v1 每 1000 mm 升 1 m；尺寸盒高 0.4 m，v1 = 0 时中心在 y */
const hoistAt = (id: string, y: number): SceneObjectConfig =>
  testObject("singlePointMove", { runDirection: 2 }, { id, position: { x: 0, y, z: 0 } });

const member = (
  config: SceneObjectConfig,
  v1 = 0,
  ranges?: DragMember["ranges"],
  parentWorld: Matrix | null = null,
): DragMember => ({
  objectId: config.id,
  input: { config, values: toFullAxisValues({ v1 }), parentWorld },
  ranges,
});

const v1Of = (solution: ReturnType<typeof solveFormation>, objectId: string) =>
  solution.updates.find((update) => update.objectId === objectId)?.values.v1;

describe("solveFormation", () => {
  const a = hoistAt("a", 3);
  const b = hoistAt("b", 2);

  it("aligns the bottom edges to a height", () => {
    // a 的底边在 2.8 m：b（底边 1.8 m）要升 1 m
    const solution = solveFormation([member(b)], { kind: "align", edge: "bottom", height: 2.8 });
    expect(v1Of(solution, "b")).toBeCloseTo(1000, 1);
    expect(solution.clamped).toEqual([]);
  });

  it("aligns the top edges of objects of different heights", () => {
    const tall = testObject("singlePointMove", { runDirection: 2 }, {
      id: "tall",
      position: { x: 0, y: 2, z: 0 },
      dimensions: { w: 2, h: 1.2, d: 1 },
    });
    const solution = solveFormation([member(tall)], { kind: "align", edge: "top", height: 3.2 });
    // 顶边原来在 2.6 m
    expect(v1Of(solution, "tall")).toBeCloseTo(600, 1);
  });

  it("scales the height differences around the average", () => {
    // 中心 3.0 / 2.0，平均 2.5：×2 → 3.5 / 1.5
    const solution = solveFormation([member(a), member(b)], { kind: "scale", factor: 2 });
    expect(v1Of(solution, "a")).toBeCloseTo(500, 1);
    expect(v1Of(solution, "b")).toBeCloseTo(-500, 1);
  });

  it("flattens with 0 and flips with −1", () => {
    const flat = solveFormation([member(a), member(b)], { kind: "scale", factor: 0 });
    expect(v1Of(flat, "a")).toBeCloseTo(-500, 1);
    expect(v1Of(flat, "b")).toBeCloseTo(500, 1);
    const flipped = solveFormation([member(a), member(b)], { kind: "scale", factor: -1 });
    expect(v1Of(flipped, "a")).toBeCloseTo(-1000, 1);
    expect(v1Of(flipped, "b")).toBeCloseTo(1000, 1);
  });

  it("stops at the end of travel and says which ones", () => {
    const range = { v1: { min: 0, max: 300 } };
    const solution = solveFormation([member(a, 0, range), member(b, 0, range)], { kind: "scale", factor: 2 });
    expect(v1Of(solution, "a")).toBe(300);
    expect(v1Of(solution, "b")).toBe(0);
    expect(solution.clamped).toEqual(["a", "b"]);
  });

  it("measures tilted plates by their tilted box and still lands on the height", () => {
    const plate = testObject("dualTiltFourPointSwing", {}, { id: "p", position: { x: 0, y: 3, z: 0 } });
    const tilted: DragMember = {
      objectId: "p",
      input: { config: plate, values: { v1: 200, v2: 12, v3: -5 }, parentWorld: null },
    };
    const solved = solveLiftForHeight(tilted, "bottom", 3.5);
    expect(solved).not.toBeNull();
    const after = { ...tilted.input, values: { ...tilted.input.values, v1: solved!.value } };
    expect(formationHeightOf(after, "bottom")).toBeCloseTo(3.5, 4);
  });

  it("skips objects whose lift doesn't change their height", () => {
    // 挂在侧放的父物体上：升降是水平的
    const sideways = member(a, 0, undefined, Matrix.RotationZ(Math.PI / 2));
    const solution = solveFormation([sideways], { kind: "align", edge: "bottom", height: 5 });
    expect(solution.updates).toEqual([]);
    expect(solution.skipped).toEqual(["a"]);
  });

  it("reports the spread of the centers", () => {
    expect(formationSpread([member(a)])).toBeNull();
    const spread = formationSpread([member(a), member(b, 250)])!;
    expect(spread.min).toBeCloseTo(2.25, 4);
    expect(spread.max).toBeCloseTo(3, 4);
    expect(spread.mean).toBeCloseTo(2.625, 4);
  });
});

describe("motionRangeOf", () => {
  it("covers the box at every sample", () => {
    const hoist = hoistAt("a", 3);
    const range = motionRangeOf(
      [
        { atMs: 0, values: { v1: 0 } },
        { atMs: 1000, values: { v1: 1000 } },
      ],
      hoist,
      () => null,
    )!;
    expect(range.min.y).toBeCloseTo(2.8, 4);
    expect(range.max.y).toBeCloseTo(4.2, 4);
    expect(range.min.x).toBeCloseTo(-1, 4);
    expect(range.max.z).toBeCloseTo(0.5, 4);
  });
});

describe("PoseHandleController formation", () => {
  let slot: HTMLDivElement;

  beforeEach(() => {
    slot = document.createElement("div");
    document.body.appendChild(slot);
  });

  afterEach(() => {
    slot.remove();
  });

  const configs = new Map<string, SceneObjectConfig>([
    ["a", hoistAt("a", 3)],
    ["b", hoistAt("b", 2)],
    ["c", hoistAt("c", 1)],
    ["r", testObject("singlePointRotation", {}, { id: "r" })],
  ]);
  const target = (objectId: string, overrides: Partial<PoseHandleTarget> = {}): PoseHandleTarget => ({
    objectId,
    kinds: configs.get(objectId)!.kinematics!.controlType === "singlePointRotation" ? ["yaw"] : ["lift"],
    values: { v1: 0, v2: 0, v3: 0 },
    ...overrides,
  });

  const setup = (targets: PoseHandleTarget[], candidates: SnapCandidate[] = []) => {
    const { projector, rayAt } = FRONT_VIEW();
    const host = {
      getCells: () => [{ id: "main" as const, rect: { left: 0, top: 0, width: 800, height: 600 }, projector, rayAt }],
      getConfig: (id: string) => configs.get(id),
      getParentWorld: () => null,
      getSnapCandidates: vi.fn(() => candidates),
      setOrbitEnabled: vi.fn(),
      setCursor: vi.fn(),
      onDragStart: vi.fn(),
      onDrag: vi.fn(),
      onDragEnd: vi.fn(),
      onBlocked: vi.fn(),
    } satisfies PoseHandleHost;
    const controller = new PoseHandleController(host, null);
    controller.setTargets(targets);
    return controller;
  };

  it("uses the liftable handles that aren't blocked", () => {
    const controller = setup([target("a"), target("b"), target("c", { blockedReason: "在预设里" }), target("r")]);
    const info = controller.formationInfo("a");
    expect(info.memberIds).toEqual(["a", "b"]);
    expect(info.blocked).toEqual([{ objectId: "c", reason: "在预设里" }]);
    expect(info.canAlign).toBe(true);
    expect(info.spread?.max).toBeCloseTo(3, 4);
  });

  it("aligns the others to the clicked one and leaves it alone", () => {
    const controller = setup([target("a"), target("b", { values: { v1: 100 } })]);
    const plan = controller.planFormation({ kind: "align", referenceId: "a", edge: "bottom" })!;
    expect(plan.updates.map((update) => update.objectId)).toEqual(["b"]);
    // b 底边 1.9 m → 2.8 m：v1 100 → 1000
    expect(plan.updates[0]!.values.v1).toBeCloseTo(1000, 1);
  });

  it("aligns to an object without handles by what the 3D shows", () => {
    const controller = setup(
      [target("a"), target("b")],
      [{ objectId: "truss", bottom: 4, top: 4.3, center: { x: 0, y: 4.15, z: 0 } }],
    );
    expect(controller.formationInfo("truss").canAlign).toBe(true);
    const plan = controller.planFormation({ kind: "align", referenceId: "truss", edge: "top" })!;
    // 顶边：a 3.2 → 4.3，b 2.2 → 4.3
    expect(plan.updates.map((update) => Math.round(update.values.v1!))).toEqual([1100, 2100]);
  });

  it("can't align when the clicked one is the only liftable object", () => {
    const controller = setup([target("a"), target("r")]);
    expect(controller.formationInfo("a").canAlign).toBe(false);
    expect(controller.planFormation({ kind: "align", referenceId: "a", edge: "bottom" })).toBeNull();
  });

  it("needs two liftable objects to scale", () => {
    expect(setup([target("a")]).planFormation({ kind: "scale", factor: 2 })).toBeNull();
    const plan = setup([target("a"), target("b"), target("c", { blockedReason: "在预设里" })]).planFormation({
      kind: "scale",
      factor: 2,
    })!;
    expect(plan.updates.map((update) => update.objectId)).toEqual(["a", "b"]);
    expect(plan.blocked.map((entry) => entry.objectId)).toEqual(["c"]);
  });

  it("frames the whole motion of the objects", () => {
    const controller = setup([]);
    const bounds = controller.motionRangeBounds(
      ["a", "b"],
      new Map([
        ["a", [{ atMs: 0, values: { v1: 0 } }, { atMs: 1000, values: { v1: 2000 } }]],
        ["b", [{ atMs: 0, values: { v1: -500 } }]],
      ]),
    )!;
    expect(bounds.min.y).toBeCloseTo(1.3, 4);
    expect(bounds.max.y).toBeCloseTo(5.2, 4);
  });
});
