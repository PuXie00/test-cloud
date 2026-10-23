import { describe, expect, it } from "vitest";
import { nearestStartPosesAt, planNearestStart, type NearestStartPlan } from "./nearest-start";
import { resolveActionSequence } from "./resolve-sequence";
import { fixtureCurrent, fixtureObjects, fixtureSequence } from "./nearest-start.fixture";

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
  it.each([true, false])("brings every member to the first frame together (forced=%s)", (forced) => {
    const result = plan({ forced, nearest: false, reverse: false });
    expect(result).toMatchObject({ forced, nearest: false, direction: 1, startMode: "boundary", targetFrameMs: 0 });
    expect(result.transitionSec).toBeCloseTo(2.5, 12);
    expect(result.prepareTimeMs).toBe(2500);
    expect(result.loopCount).toBe(1);
    expect(result.motorLimitScale).toBe(1);
    expect(moveOf(result, 1, "v1")).toMatchObject({ from: 120, to: 0 });
    expect(moveOf(result, 1, "v1")!.velocity).toBeCloseTo(50, 9);
    expect(moveOf(result, 1, "v1")!.acceleration).toBeCloseTo(500, 9);
    expect(moveOf(result, 2, "v2")!.velocity).toBeCloseTo(1.3333333333333333, 12);
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
    expect(result.transitionSec).toBeCloseTo(1.189459883650901, 12);
    expect(memberOf(result, 1).target.v1).toBeCloseTo(100, 9);
    expect(memberOf(result, 4).target.v3).toBeCloseTo(-0.689795918367347, 9);
    expect(moveOf(result, 3, "v1")!.acceleration).toBeCloseTo(128.16928446771354, 9);
  });

  it("takes the nearest shared keyframe in the running direction when not forced", () => {
    const result = plan({ forced: false, nearest: true, reverse: false });
    expect(result.targetFrameMs).toBe(4000);
    expect(result.transitionSec).toBeCloseTo(10.43333333333333, 11);
    expect(result.motorLimitScale).toBe(1);
    expect(memberOf(result, 2).target.v1).toBeCloseTo(1566.6666666666665, 9);
    expect(moveOf(result, 3, "v2")!.velocity).toBeCloseTo(0.575079872204473, 12);
    expect(plan({ forced: false, nearest: true, reverse: true }).targetFrameMs).toBe(0);
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
