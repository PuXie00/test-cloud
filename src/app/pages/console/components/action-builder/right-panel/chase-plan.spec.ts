import { describe, expect, it } from "vitest";
import { planChase, type ChaseObject } from "./chase-plan";

// 默认 100 mm/s、100 mm/s²；上限 400 mm/s、400 mm/s²
const limits = { v1: { defaultSpeed: 100, defaultAccel: 100, maxSpeed: 400, maxAccel: 400 } };
const object = (objectId: number, from: number, to: number): ChaseObject => ({
  objectId,
  name: `物体${objectId}`,
  from: { v1: from },
  to: { v1: to },
  limits,
});

describe("planChase", () => {
  it("the leader slows, the chaser merges at equal position and speed, then they run together", () => {
    const plan = planChase(0, [object(1, 0, 3000), object(2, 600, 3000)], {
      axis: "v1",
      chaserId: 1,
      leaderId: 2,
      chaserStartMs: 2000,
      leaderStartMs: 0,
    });
    expect(plan.error).toBeUndefined();
    const chase = plan.chase!;
    expect(chase.leaderSpeed).toBeLessThan(chase.sideBySideSpeed);
    const [chaser, leader] = plan.objects;
    const mergeA = chaser!.poses.find((pose) => pose.atMs === chase.mergeAtMs);
    const mergeB = leader!.poses.find((pose) => pose.atMs === chase.mergeAtMs);
    expect(mergeA).toEqual(mergeB);
    expect(mergeA!.passSpeeds!.v1).toBeCloseTo(chase.sideBySideSpeed, 1);
    // 出发、到达停稳
    expect(chaser!.poses.at(-1)!.passSpeeds).toEqual({ v1: 0 });
    expect(chaser!.segments.at(-1)!.profiles).toEqual(leader!.segments.at(-1)!.profiles);
  });

  it("rounds the ramps up so no ramp is steeper than 95% of the limit", () => {
    // 默认 200 mm/s、100 mm/s²；上限 500 mm/s、500 mm/s²。B 先慢走 246 mm/s，按 95% 起步要 0.52 s
    const tight = { v1: { defaultSpeed: 200, defaultAccel: 100, maxSpeed: 500, maxAccel: 500 } };
    const plan = planChase(
      0,
      [
        { ...object(1, 500, 4000), limits: tight },
        { ...object(2, 800, 4000), limits: tight },
      ],
      { axis: "v1", chaserId: 1, leaderId: 2, chaserStartMs: 2000, leaderStartMs: 0 },
    );
    expect(plan.error).toBeUndefined();
    const { sideBySideSpeed: v, leaderSpeed: vB } = plan.chase!;
    const cap = 500 * 0.95 + 1e-6;
    const ramps = (index: number) =>
      (plan.objects[index]!.segments[0]!.profiles.v1 as { params: { accelMs: number; decelMs: number } }).params;
    expect(v / (ramps(0).accelMs / 1000)).toBeLessThanOrEqual(cap);
    expect(vB / (ramps(1).accelMs / 1000)).toBeLessThanOrEqual(cap);
    expect((v - vB) / (ramps(1).decelMs / 1000)).toBeLessThanOrEqual(cap);
  });

  it("refuses to chase into different ends", () => {
    const plan = planChase(0, [object(1, 0, 3000), object(2, 600, 2000)], {
      axis: "v1",
      chaserId: 1,
      leaderId: 2,
      chaserStartMs: 2000,
      leaderStartMs: 0,
    });
    expect(plan.error).toBe("两台的终点不一样，汇合后没法并排");
  });
});
