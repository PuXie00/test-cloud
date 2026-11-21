import { describe, expect, it } from "vitest";
import { minimumMotionProfile } from "@/app/project/action-sequence/nearest-start-motion";
import { goAxisTravel, planGo, shorterRotation, type GoObjectInfo } from "./go-motion";
import { buildMoveTargetItem } from "./go-ready";

// 默认 100 mm/s、100 mm/s²；上限 400 mm/s、400 mm/s²
const info = (overrides: Partial<GoObjectInfo> = {}): GoObjectInfo => ({
  axes: { v1: { defaultSpeed: 100, defaultAccel: 100, maxSpeed: 400, maxAccel: 400 } },
  rotation: null,
  ...overrides,
});

const entry = (objectId: string, from: number, to: number) => ({
  objectId,
  current: { v1: from },
  target: { v1: to },
});

describe("planGo", () => {
  // 400 mm 按默认要 4 + 1 = 5 s；100 mm 刚好到 100 mm/s 就减速，要 2 s
  const two = [entry("1", 0, 400), entry("2", 0, 100)];

  it("times each object at its default speed and leaves the speeds to C++", () => {
    const plan = planGo(two, () => info(), { kind: "default" });
    expect(plan.totalSeconds).toBeCloseTo(5);
    expect(plan.slowestId).toBe("1");
    expect(plan.objects[0]?.seconds).toBeCloseTo(5);
    expect(plan.objects[1]?.seconds).toBeCloseTo(2);
    expect(plan.objects[0]?.axes).toEqual({});
    expect(plan.objects[0]?.direction).toBe(0);
  });

  it("stretches the quicker objects so everyone arrives with the slowest", () => {
    const plan = planGo(two, () => info(), { kind: "sync" });
    expect(plan.totalSeconds).toBeCloseTo(5);
    expect(plan.objects[0]?.axes.v1?.velocity).toBeCloseTo(100);
    // 2 s 拉到 5 s：k = 0.4，速度 40，加减速度 16
    const quick = plan.objects[1]?.axes.v1;
    expect(quick?.velocity).toBeCloseTo(40);
    expect(quick?.acceleration).toBeCloseTo(16);
    expect(minimumMotionProfile(100, quick!.velocity, quick!.acceleration, quick!.deceleration).time).toBeCloseTo(5);
  });

  it("speeds up to a given time within 95% of the limits", () => {
    const plan = planGo([entry("1", 0, 400)], () => info(), { kind: "duration", durationMs: 3000 });
    expect(plan.error).toBeUndefined();
    const vad = plan.objects[0]!.axes.v1!;
    expect(vad.velocity).toBeLessThanOrEqual(380);
    expect(minimumMotionProfile(400, vad.velocity, vad.acceleration, vad.deceleration).time).toBeCloseTo(3);
  });

  it("slows down to a longer given time along the default curve", () => {
    const plan = planGo([entry("1", 0, 400)], () => info(), { kind: "duration", durationMs: 10000 });
    expect(plan.objects[0]?.axes.v1?.velocity).toBeCloseTo(50);
  });

  it("refuses a time shorter than the fastest run", () => {
    // 上限 95%：380 mm/s、380 mm/s²，400 mm 约 2.05 s
    const plan = planGo([entry("1", 0, 400)], () => info(), { kind: "duration", durationMs: 1500 });
    expect(plan.error).toBe("太短了，最短 2.1 s");
    expect(plan.shortestSeconds).toBeCloseTo(2.05, 1);
  });

  it("cannot plan arrival together without configured speeds", () => {
    const plan = planGo([entry("1", 0, 400)], () => info({ axes: { v1: {} } }), { kind: "sync" });
    expect(plan.error).toBe("有物体没设默认速度或上限，只能按各自默认速度走");
    expect(planGo([entry("1", 0, 400)], () => info({ axes: { v1: {} } }), { kind: "default" }).totalSeconds).toBeNull();
  });
});

describe("continuous rotation", () => {
  const rotating = info({
    axes: { v1: { defaultSpeed: 10, defaultAccel: 10, maxSpeed: 40, maxAccel: 40 } },
    rotation: { period: 360 },
  });

  it("turns the shorter way, forward at exactly half a turn or when already there", () => {
    expect(shorterRotation(10, 350, 360)).toBe(2);
    expect(shorterRotation(350, 10, 360)).toBe(1);
    expect(shorterRotation(0, 180, 360)).toBe(1);
    expect(shorterRotation(90, 90, 360)).toBe(1);
  });

  it("measures the turn in the chosen direction, less than one turn", () => {
    expect(goAxisTravel("v1", 10, 350, { period: 360 }, 2)).toBeCloseTo(20);
    expect(goAxisTravel("v1", 10, 350, { period: 360 }, 1)).toBeCloseTo(340);
    expect(goAxisTravel("v1", 10, 730, { period: 360 }, 1)).toBeCloseTo(0);
    expect(goAxisTravel("v2", 10, 350, { period: 360 }, 1)).toBeCloseTo(340);
  });

  it("picks the direction for GO and lets the operator take the long way", () => {
    const short = planGo([entry("9", 10, 350)], () => rotating, { kind: "default" });
    expect(short.objects[0]?.direction).toBe(2);
    const long = planGo([entry("9", 10, 350)], () => rotating, { kind: "default" }, { "9": 1 });
    expect(long.objects[0]?.direction).toBe(1);
    expect(long.totalSeconds!).toBeGreaterThan(short.totalSeconds!);
  });
});

describe("buildMoveTargetItem with a plan", () => {
  it("sends the planned speeds and direction, zeros elsewhere", () => {
    const item = buildMoveTargetItem(
      { objectId: "9", target: { v1: 350 }, current: { v1: 10, v2: 0 } },
      { direction: 2, axes: { v1: { velocity: 12, acceleration: 3, deceleration: 4 } } },
    );
    expect(item).toMatchObject({
      deviceId: 9,
      hTargetPosition: 350,
      hVelocity: 12,
      hAcceleration: 3,
      hDeceleration: 4,
      pTargetPosition: 0,
      pVelocity: 0,
      moveDirection: 2,
    });
  });

  it("drops float noise but keeps small rates non-zero", () => {
    const item = buildMoveTargetItem(
      { objectId: "3", target: { v1: 3000 }, current: { v1: 1200 } },
      { direction: 0, axes: { v1: { velocity: 110.00000000000001, acceleration: 30.250000000000007, deceleration: 0.000123456789 } } },
    );
    expect(item.hVelocity).toBe(110);
    expect(item.hAcceleration).toBe(30.25);
    expect(item.hDeceleration).toBe(0.000123457);
  });
});
