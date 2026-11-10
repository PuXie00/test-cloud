import { describe, expect, it } from "vitest";
import { evaluateResolvedSequence } from "./evaluate-sequence";
import { nearestStartPosesAt, planNearestStart, type NearestStartPlan } from "./nearest-start";
import { resolveActionSequence } from "./resolve-sequence";
import {
  fixtureCurrent,
  fixtureNonforcedSequence,
  fixtureObjects,
  fixtureSequence,
} from "./nearest-start.fixture";
import type { HpyPose } from "./nearest-start-motion";

const telemetry = new Map(
  Object.entries(fixtureCurrent).map(([id, pose]) => [Number(id), { h: pose.v1, p: pose.v2, y: pose.v3 }]),
);

/**
 * 期望值：停稳同步准备在默认速度下的结果。
 * planNearestStart 会把 max_velocity_HPY 换成 default_velocity_HPY 再交给算法。
 */
const plan = (options: { forced: boolean; nearest: boolean; reverse: boolean; loop?: boolean }) =>
  planNearestStart({
    resolved: resolveActionSequence(fixtureSequence(options.forced, options.loop ?? false)),
    objects: fixtureObjects(),
    motors: [],
    telemetryByObjectId: telemetry,
    forced: options.forced,
    nearest: options.nearest,
    reverse: options.reverse,
    loopCount: options.loop ? 0 : 1,
  });

const memberOf = (result: NearestStartPlan, objectId: number) =>
  result.members.find((member) => member.objectId === objectId)!;

const moveOf = (result: NearestStartPlan, objectId: number, axis: "v1" | "v2" | "v3") =>
  memberOf(result, objectId).axes.find((move) => move.axis === axis);

describe("planNearestStart", () => {
  it("brings every member to the first frame together (forced)", () => {
    const forced = true;
    const result = plan({ forced, nearest: false, reverse: false });
    expect(result).toMatchObject({ forced, nearest: false, direction: 1, startMode: "boundary", targetFrameMs: 0 });
    expect(result.transitionSec).toBeCloseTo(2.5, 12);
    expect(result.prepareTimeMs).toBe(2500);
    expect(result.loopCount).toBe(1);
    expect(result.motorLimitScale).toBe(1);
    expect(moveOf(result, 1, "v1")).toMatchObject({ from: 120, to: 0 });
    expect(moveOf(result, 1, "v1")!.velocity).toBeCloseTo(50, 9);
    expect(moveOf(result, 1, "v1")!.acceleration).toBeCloseTo(500, 9);
    expect(moveOf(result, 3, "v2")!.velocity).toBeCloseTo(0.8, 12);
    expect(moveOf(result, 4, "v3")!.acceleration).toBeCloseTo(0.64, 12);
    for (const member of result.members) {
      expect(member.arrivalSec).toBeCloseTo(result.transitionSec, 12);
      expect(member.waitSec).toBe(0);
      for (const move of member.axes) expect(move.deceleration).toBe(move.acceleration);
    }
  });

  it("joins the last frame at the default speed cap", () => {
    const result = plan({ forced: true, nearest: false, reverse: true });
    expect(result.targetFrameMs).toBe(16000);
    expect(result.direction).toBe(-1);
    expect(result.transitionSec).toBeCloseTo(24.5, 11);
    expect(result.prepareTimeMs).toBe(24501);
    expect(result.motorLimitScale).toBe(1);
    expect(memberOf(result, 4).target.v1).toBeCloseTo(2300, 9);
    expect(memberOf(result, 4).target.v3).toBeCloseTo(15, 9);
    expect(moveOf(result, 4, "v1")!.velocity).toBeCloseTo(50, 9);
  });

  it("searches the nearest forced frame at 100ms then 10ms", () => {
    const result = plan({ forced: true, nearest: true, reverse: false });
    expect(result.startMode).toBe("nearest");
    expect(result.targetFrameMs).toBe(1040);
    // 夹具去掉两点摆后由剩下的物体决定过渡时间
    expect(result.transitionSec).toBeCloseTo(0.884022962733127, 12);
    expect(memberOf(result, 1).target.v1).toBeCloseTo(100, 9);
    expect(memberOf(result, 4).target.v3).toBeCloseTo(-0.689795918367347, 9);
    expect(moveOf(result, 3, "v1")!.acceleration).toBeCloseTo(232.0365856803875, 9);
  });

  it("runs once when a looping curve does not close", () => {
    expect(plan({ forced: true, nearest: false, reverse: false, loop: true }).loopCount).toBe(1);
  });

  it("reports a member whose motors cannot move", () => {
    const [single] = fixtureObjects();
    expect(() =>
      planNearestStart({
        resolved: resolveActionSequence(fixtureSequence(false)),
        objects: [{ ...single!, maxAxisVelocity: 0 }, ...fixtureObjects().slice(1)],
        motors: [],
        telemetryByObjectId: telemetry,
        forced: false,
        nearest: false,
        reverse: false,
        loopCount: 1,
      }),
    ).toThrow("模型1的最大电机速度必须大于0");
  });
});

describe("nearestStartPosesAt", () => {
  it("moves every member from the current pose to the target in the shared time", () => {
    const result = plan({ forced: true, nearest: false, reverse: false });
    expect(nearestStartPosesAt(result, 0).get(1)).toEqual({ v1: 120, v2: 0, v3: 0 });
    const end = result.transitionSec * 1000;
    expect(nearestStartPosesAt(result, end).get(1)!.v1).toBeCloseTo(0, 6);
    expect(nearestStartPosesAt(result, end).get(3)!.v1).toBeCloseTo(1000, 6);
    const mid = nearestStartPosesAt(result, end / 2).get(1)!.v1;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(120);
  });
});

describe("planNearestStart（非强制）", () => {
  const nonforced = (options: {
    nearest: boolean;
    reverse: boolean;
    referenceFrameMs?: number;
    telemetry?: ReadonlyMap<number, HpyPose>;
  }) =>
    planNearestStart({
      resolved: resolveActionSequence(fixtureNonforcedSequence()),
      objects: fixtureObjects(),
      motors: [],
      telemetryByObjectId: options.telemetry ?? telemetry,
      forced: false,
      nearest: options.nearest,
      reverse: options.reverse,
      loopCount: 1,
      ...(options.referenceFrameMs !== undefined ? { referenceFrameMs: options.referenceFrameMs } : {}),
    });

  /** 过渡结束时（按实际准备 Move 回放）各轴离接入点不超过算法的核对容差 */
  const expectJoined = (result: NearestStartPlan) => {
    const end = nearestStartPosesAt(result, result.transitionSec * 1000);
    for (const member of result.members) {
      for (const axis of ["v1", "v2", "v3"] as const) {
        expect(Math.abs(end.get(member.objectId)![axis] - member.target[axis])).toBeLessThanOrEqual(0.05);
      }
    }
  };

  it("sends one move per axis for every member at GO and reaches the start together", () => {
    const result = nonforced({ nearest: false, reverse: false });
    expect(result).toMatchObject({
      forced: false,
      startMode: "boundary",
      direction: 1,
      targetFrameMs: 0,
      motorLimitScale: null,
      loopCount: 1,
    });
    expect(result.prepareTimeMs).toBe(Math.ceil(result.transitionSec * 1000));
    for (const member of result.members) {
      expect(member.axes.map((move) => move.axis)).toEqual(["v1", "v2", "v3"]);
      for (const move of member.axes) {
        expect(move.entryMove!.vel).toBeGreaterThan(0);
        expect(move.joinVelocity).toBe(0);
      }
    }
    expect(memberOf(result, 1).target.v1).toBe(0);
    expect(memberOf(result, 3).target.v1).toBe(1000);
    expectJoined(result);
  });

  it("continues from where the members stopped by joining the curve at speed", () => {
    const resolved = resolveActionSequence(fixtureNonforcedSequence());
    const stopped = new Map(
      [...evaluateResolvedSequence(resolved, 10000)].map(([id, pose]) => [id, { h: pose.v1, p: pose.v2, y: pose.v3 }]),
    );
    const result = nonforced({ nearest: true, reverse: false, referenceFrameMs: 10000, telemetry: stopped });
    expect(result.startMode).toBe("nearest");
    expect(result.targetFrameMs).toBeGreaterThan(10000);
    expect(result.targetFrameMs).toBeLessThanOrEqual(13000);
    expect(result.members.some((member) => member.axes.some((move) => move.joinVelocity !== 0))).toBe(true);
    expectJoined(result);
  });

  it("names the original move that is beyond the device capability", () => {
    // 原夹具物体 4 的 Y 速度 3.9°/s 超出最大 3°/s
    expect(() =>
      planNearestStart({
        resolved: resolveActionSequence(fixtureSequence(false)),
        objects: fixtureObjects(),
        motors: [],
        telemetryByObjectId: telemetry,
        forced: false,
        nearest: false,
        reverse: false,
        loopCount: 1,
      }),
    ).toThrow(/^起点无法接入：模型4 Y原帧表.*vel=3\.9超过最大能力3/);
  });

  it("does not refuse a member that sits slightly outside its stroke", () => {
    const below = new Map(telemetry);
    below.set(1, { h: -0.5, p: 0, y: 0 });
    const result = nonforced({ nearest: false, reverse: false, telemetry: below });
    expect(moveOf(result, 1, "v1")).toMatchObject({ from: -0.5, to: 0 });
  });
});
