import { describe, expect, it } from "vitest";
import type { SceneObjectConfig } from "../types";
import { ARC_DRAG_PX_PER_RAD, createPoseHandleDragSession, type DragMember } from "./pose-handle-drag";
import {
  frontDirectionOf,
  headingDirectionOf,
  localTopCenter,
  plateNormalOf,
  restNormalOf,
  worldPointOf,
  type PoseKinematics,
} from "./pose-handle-kinematics";
import {
  COMPACT_RING_RADIUS_PX,
  HANDLE_SPOT_PX,
  hitTestHandles,
  layoutPoseHandle,
  placeRingModel,
  ringPoint,
} from "./pose-handle-layout";
import { angleBetween, normalizeVec, rotateVec, subVec, type Pt } from "./pose-handle-math";
import { poseHandleModel, type RingHandleModel } from "./pose-handle-model";
import { FRONT_VIEW, orthoCamera, testObject, TOP_VIEW } from "./pose-handle-test-utils";

const member = (
  objectId: string,
  config: SceneObjectConfig,
  values: Partial<PoseKinematics["values"]> = {},
): DragMember => ({
  objectId,
  input: { config, values: { v1: 0, v2: 0, v3: 0, ...values }, parentWorld: null },
});

const valueOf = (frame: ReturnType<NonNullable<ReturnType<typeof createPoseHandleDragSession>>["update"]>, objectId: string) =>
  frame?.updates.find((update) => update.objectId === objectId)?.values;

describe("lift drag", () => {
  it("moves every hoist by the same world distance, each in its own run direction", () => {
    const { projector, rayAt } = FRONT_VIEW();
    const start: Pt = { x: 400, y: 0 };
    const session = createPoseHandleDragSession({
      kind: "lift",
      members: [
        member("a", testObject("singlePointMove"), { v1: 1000 }),
        member("b", testObject("singlePointMove", { runDirection: 2 }, { position: { x: 3, y: 3, z: 0 } }), { v1: 1000 }),
      ],
      projector,
      rayAt,
      start,
    })!;
    const frame = session.update({ x: 400, y: -50 }, { fine: false });
    // Babylon 矩阵是单精度：误差在 0.01 mm 以内
    expect(valueOf(frame, "a")!.v1).toBeCloseTo(500, 1);
    expect(valueOf(frame, "b")!.v1).toBeCloseTo(1500, 1);
  });

  it("raises a multi-point swing by the same height as the hoist next to it", () => {
    const { projector, rayAt } = FRONT_VIEW();
    const swing = member("s", testObject("multiPointSwing", { runDirection: 2 }, { position: { x: 3, y: 3, z: 0 } }), {
      v1: 1000,
      v2: 10,
    });
    const session = createPoseHandleDragSession({
      kind: "lift",
      members: [member("a", testObject("singlePointMove", { runDirection: 2 }), { v1: 1000 }), swing],
      projector,
      rayAt,
      start: { x: 400, y: 0 },
    })!;
    const frame = session.update({ x: 400, y: -40 }, { fine: false });
    const before = worldPointOf(swing.input, localTopCenter(swing.input.config));
    const after = worldPointOf(
      { ...swing.input, values: { ...swing.input.values, ...valueOf(frame, "s") } },
      localTopCenter(swing.input.config),
    );
    expect(after.y - before.y).toBeCloseTo(0.4, 4);
  });

  it("drags a tenth as far with Shift", () => {
    const { projector, rayAt } = FRONT_VIEW();
    const session = createPoseHandleDragSession({
      kind: "lift",
      members: [member("a", testObject("singlePointMove", { runDirection: 2 }))],
      projector,
      rayAt,
      start: { x: 400, y: 0 },
    })!;
    session.update({ x: 400, y: -20 }, { fine: false });
    const frame = session.update({ x: 400, y: -70 }, { fine: true });
    expect(valueOf(frame, "a")!.v1).toBeCloseTo(200 + 50, 1);
  });

  it("snaps to the same bottom height as a neighbour", () => {
    const { projector, rayAt } = FRONT_VIEW();
    const config = testObject("singlePointMove", { runDirection: 2 });
    const session = createPoseHandleDragSession({
      kind: "lift",
      members: [member("a", config)],
      projector,
      rayAt,
      start: { x: 400, y: 0 },
      snapCandidates: [{ objectId: "n", bottom: 2.8 + 0.53, top: 9, center: { x: 4, y: 4, z: 0 } }],
    })!;
    const frame = session.update({ x: 400, y: -50 }, { fine: false });
    expect(valueOf(frame, "a")!.v1).toBeCloseTo(530, 1);
    expect(frame?.snap?.label).toBe("底边同高");
    const fine = createPoseHandleDragSession({
      kind: "lift",
      members: [member("a", config)],
      projector,
      rayAt,
      start: { x: 400, y: 0 },
      snapCandidates: [{ objectId: "n", bottom: 2.8 + 0.53, top: 9, center: { x: 4, y: 4, z: 0 } }],
    })!.update({ x: 400, y: -50 }, { fine: true });
    expect(fine?.snap).toBeNull();
  });

  it("drags by screen height when looking straight down", () => {
    const { projector, rayAt } = TOP_VIEW();
    const session = createPoseHandleDragSession({
      kind: "lift",
      members: [member("a", testObject("singlePointMove", { runDirection: 2 }))],
      projector,
      rayAt,
      start: { x: 400, y: 300 },
    })!;
    expect(valueOf(session.update({ x: 400, y: 270 }, { fine: false }), "a")!.v1).toBeCloseTo(300, 1);
  });
});

/** 手柄环上某个角度在屏幕上的位置：环画在升降箭头的位置（placeRingModel） */
const ringStart = (model: RingHandleModel, projector: ReturnType<typeof TOP_VIEW>["projector"], angle: number) => {
  const placed = placeRingModel(model, projector);
  return projector.project(ringPoint(placed, placed.radius, angle))!;
};

describe("ring drag", () => {
  for (const runDirection of [1, 2] as const) {
    it(`turns the front toward the pointer (run direction ${runDirection})`, () => {
      const { projector, rayAt } = TOP_VIEW();
      const config = testObject("singlePointRotation", { runDirection }, { rotation: { x: 0, y: 0.4, z: 0 } });
      const lead = member("a", config, { v1: 20 });
      const model = poseHandleModel("yaw", lead.input) as RingHandleModel;
      const session = createPoseHandleDragSession({
        kind: "yaw",
        members: [lead],
        projector,
        rayAt,
        start: ringStart(model, projector, 0),
      })!;
      session.update(ringStart(model, projector, 0.6), { fine: false });
      const frame = session.update(ringStart(model, projector, 1.2), { fine: false });
      const turned = frontDirectionOf({ ...lead.input, values: { ...lead.input.values, ...valueOf(frame, "a") } });
      const placed = placeRingModel(model, projector);
      const expected = normalizeVec(subVec(ringPoint(placed, placed.radius, 1.2), placed.center))!;
      expect(angleBetween(turned, expected)).toBeLessThan(1e-3);
      expect(frame?.sweep?.angle).toBeCloseTo(1.2, 6);
    });
  }

  it("rocks a four-point tilt arc seen from the front, by a fixed amount per pixel along the arc", () => {
    const { projector, rayAt } = FRONT_VIEW();
    const lead = member("a", testObject("dualTiltFourPointSwing"));
    const model = poseHandleModel("tiltX", lead.input) as RingHandleModel;
    expect(model).not.toBeNull();
    const knob = ringStart(model, projector, 0);
    const session = createPoseHandleDragSession({ kind: "tiltX", members: [lead], projector, rayAt, start: knob })!;
    // 弧顶的切线是水平的：往弧上 20° 那一侧拖 20° 对应的像素
    const toward = ringStart(model, projector, 0.2);
    const step = ARC_DRAG_PX_PER_RAD * ((20 * Math.PI) / 180) * Math.sign(toward.x - knob.x);
    const frame = session.update({ x: knob.x + step, y: knob.y }, { fine: false });
    const values = { ...lead.input.values, ...valueOf(frame, "a") };
    expect(Math.abs(values.v2)).toBeCloseTo(20, 3);
    const normal = plateNormalOf({ ...lead.input, values });
    expect(angleBetween(normal, { x: 0, y: 1, z: 0 })).toBeCloseTo((20 * Math.PI) / 180, 3);
  });

  it("snaps a tilt back to level", () => {
    const { projector, rayAt } = FRONT_VIEW();
    const lead = member("a", testObject("dualTiltFourPointSwing"), { v2: 5 });
    const model = poseHandleModel("tiltX", lead.input) as RingHandleModel;
    const session = createPoseHandleDragSession({
      kind: "tiltX",
      members: [lead],
      projector,
      rayAt,
      start: ringStart(model, projector, 0),
    })!;
    const knob = ringStart(model, projector, 0);
    const toward = ringStart(model, projector, -0.2);
    const step = ARC_DRAG_PX_PER_RAD * ((4.6 * Math.PI) / 180) * Math.sign(toward.x - knob.x);
    const frame = session.update({ x: knob.x + step, y: knob.y }, { fine: false });
    expect(valueOf(frame, "a")!.v2).toBeCloseTo(0, 6);
    expect(frame?.snap?.label).toBe("水平");
  });
});

describe("multi-point swing drag", () => {
  it("rocks the plate with the swing X arc", () => {
    const lead = member("a", testObject("multiPointSwing"));
    const model = poseHandleModel("tiltX", lead.input) as RingHandleModel;
    // 正对着弧看（视线沿摆动的转轴）
    const { projector, rayAt } = orthoCamera(model.rotationAxis, { x: 0, y: 1, z: 0 });
    const session = createPoseHandleDragSession({
      kind: "tiltX",
      members: [lead],
      projector,
      rayAt,
      start: ringStart(model, projector, 0),
    })!;
    const knob = ringStart(model, projector, 0);
    // 弧顶的切线方向
    const toward = ringStart(model, projector, 0.001);
    const along = { x: toward.x - knob.x, y: toward.y - knob.y };
    const length = Math.hypot(along.x, along.y);
    const step = ARC_DRAG_PX_PER_RAD * ((20 * Math.PI) / 180);
    const frame = session.update(
      { x: knob.x + (along.x / length) * step, y: knob.y + (along.y / length) * step },
      { fine: false },
    );
    const values = { ...lead.input.values, ...valueOf(frame, "a") };
    expect(Math.abs(values.v2)).toBeCloseTo(20, 1);
    expect(angleBetween(plateNormalOf({ ...lead.input, values }), { x: 0, y: 1, z: 0 })).toBeCloseTo(
      (20 * Math.PI) / 180,
      3,
    );
  });

  for (const v2 of [0, 12]) {
    it(`turns the tilt direction with the heading ring (tilt ${v2}°)`, () => {
      const { projector, rayAt } = TOP_VIEW();
      const config = testObject("multiPointSwing", { betaInit: 30 });
      const lead = member("a", config, { v2, v3: 15 });
      const model = poseHandleModel("heading", lead.input) as RingHandleModel;
      expect(model.kind).toBe("heading");
      const session = createPoseHandleDragSession({
        kind: "heading",
        members: [lead],
        projector,
        rayAt,
        start: ringStart(model, projector, 0),
      })!;
      session.update(ringStart(model, projector, 0.3), { fine: false });
      const frame = session.update(ringStart(model, projector, 0.6), { fine: false });
      const after = { ...lead.input, values: { ...lead.input.values, ...valueOf(frame, "a") } };
      const axis = restNormalOf(lead.input);
      const expected = rotateVec(headingDirectionOf(lead.input, axis), model.rotationAxis, 0.6);
      expect(angleBetween(headingDirectionOf(after, axis), expected)).toBeLessThan(1e-3);
      expect(valueOf(frame, "a")!.v2).toBeUndefined();
    });
  }

  it("turns other swings' direction by the same world angle", () => {
    const { projector, rayAt } = TOP_VIEW();
    const lead = member("a", testObject("multiPointSwing"), { v2: 10 });
    const other = member("b", testObject("multiPointSwing", { betaInit: 90, runDirection: 2 }), { v2: 10 });
    const model = poseHandleModel("heading", lead.input) as RingHandleModel;
    const session = createPoseHandleDragSession({
      kind: "heading",
      members: [lead, other],
      projector,
      rayAt,
      start: ringStart(model, projector, 0),
    })!;
    session.update(ringStart(model, projector, 0.25), { fine: false });
    const frame = session.update(ringStart(model, projector, 0.5), { fine: false });
    for (const entry of [lead, other]) {
      const axis = restNormalOf(entry.input);
      const after = { ...entry.input, values: { ...entry.input.values, ...valueOf(frame, entry.objectId) } };
      const expected = rotateVec(headingDirectionOf(entry.input, axis), model.rotationAxis, 0.5);
      expect(angleBetween(headingDirectionOf(after, axis), expected)).toBeLessThan(1e-3);
    }
  });
});

describe("hitTestHandles", () => {
  it("finds the lift arrow above the object and ignores far clicks", () => {
    const { projector } = FRONT_VIEW();
    const lead = member("a", testObject("singlePointMove"));
    const layout = layoutPoseHandle("a", poseHandleModel("lift", lead.input)!, projector)!;
    const anchor = projector.project({ x: 0, y: 3.2, z: 0 })!;
    expect(hitTestHandles([layout], { x: anchor.x + 2, y: anchor.y - 50 })?.layout.kind).toBe("lift");
    expect(hitTestHandles([layout], { x: anchor.x + 40, y: anchor.y - 50 })).toBeNull();
  });

  it("puts the swing arc where the lift arrow is, about as big", () => {
    const { projector } = FRONT_VIEW();
    const lead = member("a", testObject("dualTiltFourPointSwing"));
    const layout = layoutPoseHandle("a", poseHandleModel("tiltX", lead.input)!, projector)!;
    const anchor = projector.project({ x: 0, y: 3.2, z: 0 })!;
    // 圆头在手柄中心正上方一个半径
    const knob = layout.knobs[0]!;
    expect(knob.x).toBeCloseTo(anchor.x, 3);
    expect(knob.y).toBeCloseTo(anchor.y - HANDLE_SPOT_PX - COMPACT_RING_RADIUS_PX, 3);
    expect(hitTestHandles([layout], knob)?.layout.kind).toBe("tiltX");
    // 弧两头有箭头
    expect(layout.fills).toHaveLength(2);
  });
});
