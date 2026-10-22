import { describe, expect, it } from "vitest";
import { nearestStartPosesAt, planNearestStart, type NearestStartPlan } from "./nearest-start";
import { resolveActionSequence } from "./resolve-sequence";
import { fixtureCurrent, fixtureObjects, fixtureSequence } from "./nearest-start.fixture";

const telemetry = new Map(
  Object.entries(fixtureCurrent).map(([id, pose]) => [Number(id), { h: pose.v1, p: pose.v2, y: pose.v3 }]),
);

/**
 * 期望值：把 buildAlgorithmModels 对夹具生成的 models / runtime 交给
 * python/就近计算/就近接入计算.py（停稳同步准备）计算得到。
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
    expect(result.transitionSec).toBeCloseTo(1.632993161855452, 12);
    expect(result.prepareTimeMs).toBe(1633);
    expect(result.loopCount).toBe(1);
    expect(result.motorLimitScale).toBe(1);
    expect(moveOf(result, 1, "v1")).toMatchObject({ from: 120, to: 0 });
    expect(moveOf(result, 1, "v1")!.velocity).toBeCloseTo(146.96938456699073, 9);
    expect(moveOf(result, 1, "v1")!.acceleration).toBeCloseTo(180.00000000000006, 9);
    expect(moveOf(result, 2, "v2")!.velocity).toBeCloseTo(2.449489742783178, 12);
    expect(moveOf(result, 4, "v3")!.acceleration).toBeCloseTo(1.5000000000000002, 12);
    for (const member of result.members) {
      expect(member.arrivalSec).toBeCloseTo(result.transitionSec, 12);
      expect(member.waitSec).toBe(0);
      for (const move of member.axes) expect(move.deceleration).toBe(move.acceleration);
    }
  });

  it("slows every member by the same motor factor from the last frame", () => {
    const result = plan({ forced: true, nearest: false, reverse: true });
    expect(result.targetFrameMs).toBe(16000);
    expect(result.direction).toBe(-1);
    expect(result.transitionSec).toBeCloseTo(11.47397093906666, 11);
    expect(result.prepareTimeMs).toBe(11474);
    expect(result.motorLimitScale).toBeCloseTo(0.5519739736981166, 12);
    expect(memberOf(result, 4).target.v1).toBeCloseTo(2300, 9);
    expect(memberOf(result, 4).target.v3).toBeCloseTo(15, 9);
    expect(moveOf(result, 4, "v1")!.velocity).toBeCloseTo(149.904510751699, 9);
  });

  it("searches the nearest forced frame at 100ms then 10ms", () => {
    const result = plan({ forced: true, nearest: true, reverse: false });
    expect(result.startMode).toBe("nearest");
    expect(result.targetFrameMs).toBe(1350);
    expect(result.transitionSec).toBeCloseTo(0.7745966692414834, 12);
    expect(memberOf(result, 1).target.v1).toBeCloseTo(148.4375, 9);
    expect(memberOf(result, 4).target.v3).toBeCloseTo(-1.162308673469388, 9);
    expect(moveOf(result, 3, "v1")!.acceleration).toBeCloseTo(500, 9);
  });

  it("takes the nearest shared keyframe in the running direction when not forced", () => {
    const result = plan({ forced: false, nearest: true, reverse: false });
    expect(result.targetFrameMs).toBe(4000);
    expect(result.transitionSec).toBeCloseTo(4.853576341631632, 11);
    expect(result.motorLimitScale).toBeCloseTo(0.5551461962868086, 12);
    expect(memberOf(result, 2).target.v1).toBeCloseTo(1566.6666666666665, 9);
    expect(moveOf(result, 3, "v2")!.velocity).toBeCloseTo(1.5795912389191669, 12);
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
