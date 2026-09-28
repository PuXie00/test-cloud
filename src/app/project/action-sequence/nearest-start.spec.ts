import { describe, expect, it } from "vitest";
import { nearestStartPosesAt, planNearestStart, type NearestStartPlan } from "./nearest-start";
import { buildNearestStartMember } from "./nearest-start-model";
import { resolveActionSequence } from "./resolve-sequence";
import { fixtureCurrent, fixtureObjects, fixtureSequence } from "./nearest-start.fixture";

/** 期望值由 python/就近位置计算.py 对同一组输入计算得到（非强制关键帧取编程位姿点）。 */
const plan = (options: { forced: boolean; nearest: boolean; reverse: boolean; loop?: boolean }) => {
  const sequence = fixtureSequence(options.forced, options.loop ?? false);
  return planNearestStart({
    resolved: resolveActionSequence(sequence),
    members: fixtureObjects().map((object) =>
      buildNearestStartMember(object, [], fixtureCurrent[object.id]!),
    ),
    forced: options.forced,
    nearest: options.nearest,
    reverse: options.reverse,
    loopOnce: !options.loop,
  });
};

const memberOf = (result: NearestStartPlan, objectId: number) =>
  result.members.find((member) => member.objectId === objectId)!;

describe("planNearestStart forced", () => {
  it("goes to the first frame with default V/A and waits for the slowest member", () => {
    const result = plan({ forced: true, nearest: false, reverse: false });
    expect(result.targetFrameMs).toBe(0);
    expect(result.transitionSec).toBeCloseTo(4.4, 9);
    expect(result.xSafe).toBe(false);
    expect(memberOf(result, 1).arrivalSec).toBeCloseTo(4.4, 9);
    expect(memberOf(result, 2).arrivalSec).toBeCloseTo(4.0, 9);
    expect(memberOf(result, 3).arrivalSec).toBeCloseTo(2.8284271247461903, 9);
    expect(memberOf(result, 4).arrivalSec).toBeCloseTo(3.577708763999664, 9);
    expect(memberOf(result, 3).waitSec).toBeCloseTo(4.4 - 2.8284271247461903, 9);
    const move = memberOf(result, 2).axes.find((axis) => axis.axis === "v2")!;
    expect(move).toMatchObject({ velocity: 2, from: 2, to: 0 });
    expect(move.deceleration).toBe(move.acceleration);
  });

  it("starts from the last frame when reversed", () => {
    const result = plan({ forced: true, nearest: false, reverse: true });
    expect(result.targetFrameMs).toBe(16000);
    expect(result.transitionSec).toBeCloseTo(26.4, 9);
    expect(memberOf(result, 4).target).toEqual({ v1: 2300, v2: -8, v3: 15 });
  });

  it("searches the nearest frame at 100ms then 10ms", () => {
    const result = plan({ forced: true, nearest: true, reverse: false });
    expect(result.targetFrameMs).toBe(1040);
    expect(result.transitionSec).toBeCloseTo(2.462415899780552, 9);
    expect(memberOf(result, 1).target.v1).toBeCloseTo(100, 6);
    expect(memberOf(result, 2).target.v1).toBeCloseTo(1075.111111111, 6);
    expect(memberOf(result, 2).target.v2).toBeCloseTo(0.938888889, 6);
    expect(memberOf(result, 4).target.v3).toBeCloseTo(-0.689795918, 6);
    expect(memberOf(result, 4).arrivalSec).toBeCloseTo(1.9926395170471667, 9);
  });

  it("keeps the same nearest frame when looping", () => {
    expect(plan({ forced: true, nearest: true, reverse: false, loop: true }).targetFrameMs).toBe(1040);
  });
});

describe("planNearestStart non-forced", () => {
  it("slows every member by one factor when the motor bound exceeds its limit", () => {
    const [single] = fixtureObjects();
    const result = planNearestStart({
      resolved: resolveActionSequence(fixtureSequence(false)),
      members: [buildNearestStartMember({ ...single!, maxAxisVelocity: 100 }, [], { v1: 120, v2: 0, v3: 0 })],
      forced: false,
      nearest: false,
      reverse: false,
      loopOnce: true,
    });
    const peak = Math.sqrt((2 * 120 * 500 * 500) / 1000);
    expect(result.motorLimitScale).toBeCloseTo(100 / peak, 9);
    const move = result.members[0]!.axes[0]!;
    expect(move.velocity).toBeCloseTo(100, 6);
    expect(result.transitionSec).toBeCloseTo((2 * peak) / 500 / (100 / peak), 6);
  });

  it("syncs every moving axis to the slowest one", () => {
    const result = plan({ forced: false, nearest: false, reverse: false });
    expect(result.targetFrameMs).toBe(0);
    expect(result.transitionSec).toBeCloseTo(1.6329931618554518, 9);
    expect(result.xSafe).toBeNull();
    for (const member of result.members) {
      for (const move of member.axes) expect(move.durationSec).toBeCloseTo(result.transitionSec, 9);
    }
    const v1 = (id: number) => memberOf(result, id).axes.find((axis) => axis.axis === "v1")!;
    expect(v1(1).velocity).toBeCloseTo(146.969384567, 6);
    expect(v1(2).velocity).toBeCloseTo(122.474487139, 6);
    expect(v1(3).velocity).toBeCloseTo(61.23724357, 6);
    expect(v1(4).velocity).toBeCloseTo(97.979589711, 6);
  });

  it("takes the next shared pose keyframe after the nearest time", () => {
    const result = plan({ forced: false, nearest: true, reverse: false });
    expect(result.targetFrameMs).toBe(4000);
    expect(result.transitionSec).toBeCloseTo(4.853576341631633, 9);
    expect(memberOf(result, 2).target.v1).toBeCloseTo(1566.666666667, 6);
    expect(memberOf(result, 4).target.v3).toBeCloseTo(-5.892857143, 6);
    const p = memberOf(result, 3).axes.find((axis) => axis.axis === "v2")!;
    expect(p.velocity).toBeCloseTo(1.579591239, 6);
  });

  it("walks keyframes backwards when reversed", () => {
    expect(plan({ forced: false, nearest: false, reverse: true }).targetFrameMs).toBe(16000);
    expect(plan({ forced: false, nearest: false, reverse: true }).transitionSec).toBeCloseTo(
      11.473970939066657,
      9,
    );
    expect(plan({ forced: false, nearest: true, reverse: true }).targetFrameMs).toBe(0);
  });

  it("reports a candidate that cannot run", () => {
    const [single] = fixtureObjects();
    const sequence = fixtureSequence(false);
    expect(() =>
      planNearestStart({
        resolved: resolveActionSequence(sequence),
        members: [buildNearestStartMember({ ...single!, maxAxisVelocity: 0 }, [], { v1: 120, v2: 0, v3: 0 })],
        forced: false,
        nearest: false,
        reverse: false,
        loopOnce: true,
      }),
    ).toThrow(/最大电机速度必须为有限正数/);
  });
});

describe("nearestStartPosesAt", () => {
  it("moves from the current pose to the target and holds early arrivals", () => {
    const result = plan({ forced: true, nearest: false, reverse: false });
    expect(nearestStartPosesAt(result, 0).get(1)).toEqual({ v1: 120, v2: 0, v3: 0 });
    expect(nearestStartPosesAt(result, 4400).get(1)!.v1).toBeCloseTo(0, 9);
    const early = memberOf(result, 3);
    expect(nearestStartPosesAt(result, early.arrivalSec * 1000 + 500).get(3)).toEqual(early.target);
    const mid = nearestStartPosesAt(result, 2200).get(1)!.v1;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(120);
  });
});
