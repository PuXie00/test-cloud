import { describe, expect, it } from "vitest";
import { axisMotionVelocityAt } from "./axis-motion";
import { compilePlcAction } from "./compile-plc-action";
import { evaluateResolvedSequence } from "./evaluate-sequence";
import { resolveActionSequence, segmentAxisMotion } from "./resolve-sequence";
import type { ActionSequenceConfig, KeyframePose, PoseBlock } from "./types";
import { validateActionSequence, type AxisLimit } from "./validate-sequence";

const pose = (
  id: string,
  atMs: number,
  value: KeyframePose,
  passSpeeds?: PoseBlock["passSpeeds"],
): PoseBlock => ({
  id,
  kind: "pose",
  objectId: 1,
  atMs,
  pose: value,
  ...(passSpeeds ? { passSpeeds } : {}),
});

const sequenceOf = (
  blocks: PoseBlock[],
  extra: Partial<ActionSequenceConfig> = { continuousMotion: true },
): ActionSequenceConfig => ({
  id: 1,
  name: "continuous",
  trajectoryMode: true,
  blocks,
  segments: [],
  ...extra,
});

const limit: AxisLimit = { min: -1e6, max: 1e6, maxVelocity: 1e6, minAccelTime: 0.001 };
const context = { objects: [{ id: 1, enabledVirtualAxes: ["v1"] as const, limits: { v1: limit } }] };
const validationOf = (axisLimit: AxisLimit) => ({
  objects: [{ id: 1, enabledVirtualAxes: ["v1"] as "v1"[], limits: { v1: axisLimit } }],
});

const v1Motions = (sequence: ActionSequenceConfig) =>
  resolveActionSequence(sequence).segments.map((segment) => segment.axes!.v1);

const junctionsOf = (sequence: ActionSequenceConfig) =>
  resolveActionSequence(sequence).posesByObject.get(1)!.map((point) => point.junctions?.v1);

// ① 0–4s 慢速走到 400，4–6s 快速走到 1000
const slowFast = [pose("p0", 0, { v1: 0 }), pose("p1", 4000, { v1: 400 }), pose("p2", 6000, { v1: 1000 })];
// ②③ 快慢交替
const alternating = [
  pose("p0", 0, { v1: 0 }),
  pose("p1", 4000, { v1: 400 }),
  pose("p2", 6000, { v1: 1000 }),
  pose("p3", 8000, { v1: 1700 }),
  pose("p4", 10000, { v1: 1900 }),
];

describe("continuous motion between poses", () => {
  it("passes a middle pose at the harmonic mean of the two average speeds", () => {
    const [slow, fast] = v1Motions(sequenceOf(slowFast));
    expect(slow).toMatchObject({ startSpeed: 0, endSpeed: 150 });
    expect(fast).toMatchObject({ startSpeed: 150, endSpeed: 0 });
    // 默认首尾变速各占 20%：0 → 106.25 → 150 → 356.25 → 0
    expect(axisMotionVelocityAt(slow!, 2000)).toBeCloseTo(106.25);
    expect(axisMotionVelocityAt(fast!, 4000)).toBeCloseTo(150);
    expect(axisMotionVelocityAt(fast!, 5000)).toBeCloseTo(356.25);
    expect(junctionsOf(sequenceOf(slowFast))).toEqual([
      { speed: 0, kind: "edge" },
      { speed: 150, kind: "auto" },
      { speed: 0, kind: "edge" },
    ]);
    const resolved = resolveActionSequence(sequenceOf(slowFast));
    expect(evaluateResolvedSequence(resolved, 4000).get(1)?.v1).toBeCloseTo(400);
    expect(evaluateResolvedSequence(resolved, 6000).get(1)?.v1).toBeCloseTo(1000);
  });

  it("keeps stopping at every pose in old sequences", () => {
    const [slow, fast] = v1Motions(sequenceOf(slowFast, {}));
    expect(slow).toMatchObject({ startSpeed: 0, endSpeed: 0 });
    expect(axisMotionVelocityAt(fast!, 5000)).toBeCloseTo(375);
    expect(junctionsOf(sequenceOf(slowFast, {}))[1]).toEqual({ speed: 0, kind: "per-frame" });
  });

  it("follows hand-entered pass speeds, 0 meaning stop", () => {
    const auto = v1Motions(sequenceOf(alternating));
    expect(auto.map((motion) => motion?.endSpeed)).toEqual([
      150,
      expect.closeTo(323.08, 2),
      expect.closeTo(155.56, 2),
      0,
    ]);

    const manual = sequenceOf([
      alternating[0]!,
      alternating[1]!,
      pose("p2", 6000, { v1: 1000 }, { v1: 150 }),
      pose("p3", 8000, { v1: 1700 }, { v1: 100 }),
      alternating[4]!,
    ]);
    const motions = v1Motions(manual);
    // 0 → 106 → 150 → 338 → 150 → 406 → 100 → 113 → 0
    expect(axisMotionVelocityAt(motions[1]!, 5000)).toBeCloseTo(337.5);
    expect(axisMotionVelocityAt(motions[2]!, 7000)).toBeCloseTo(406.25);
    expect(axisMotionVelocityAt(motions[3]!, 9000)).toBeCloseTo(112.5);
    expect(junctionsOf(manual)[2]).toEqual({ speed: 150, kind: "manual" });

    const stopped = v1Motions(
      sequenceOf([alternating[0]!, pose("p1", 4000, { v1: 400 }, { v1: 0 }), alternating[2]!]),
    );
    expect(stopped[0]?.endSpeed).toBe(0);
  });

  it("stops where the axis turns back or holds", () => {
    expect(
      junctionsOf(
        sequenceOf([pose("p0", 0, { v1: 0 }), pose("top", 4000, { v1: 1000 }), pose("p2", 8000, { v1: 0 })]),
      )[1],
    ).toEqual({ speed: 0, kind: "reverse" });
    expect(
      junctionsOf(
        sequenceOf([
          pose("p0", 0, { v1: 0 }),
          pose("a", 3000, { v1: 500 }),
          pose("b", 5000, { v1: 500 }),
          pose("p3", 8000, { v1: 1000 }),
        ]),
      ).slice(1, 3),
    ).toEqual([
      { speed: 0, kind: "hold" },
      { speed: 0, kind: "hold" },
    ]);
  });

  it("joins the loop seam when the path runs the same way across it", () => {
    // 0 ↑500 ↓-500 ↑0：末段和首段都向上，首尾以 250 衔接
    const loop = sequenceOf(
      [
        pose("p0", 0, { v1: 0 }),
        pose("p1", 2000, { v1: 500 }),
        pose("p2", 6000, { v1: -500 }),
        pose("p3", 8000, { v1: 0 }),
      ],
      { continuousMotion: true, loop: true },
    );
    const motions = v1Motions(loop);
    expect(motions[0]?.startSpeed).toBeCloseTo(250);
    expect(motions[2]?.endSpeed).toBeCloseTo(250);
    const junctions = junctionsOf(loop);
    expect(junctions[0]).toEqual({ speed: 250, kind: "auto" });
    expect(junctions[3]).toEqual({ speed: 250, kind: "seam" });

    const compiled = compilePlcAction(loop, context);
    // PLC 时间单位 0.1 s：首行带 25 每 0.1 s 的初速度
    expect(compiled.timelines[0]!.segments[0]!.b).toBeCloseTo(25);
    expect(compiled.models[0]!.timeBlockList.map((block) => block.virtualAxis[0]?.passVel)).toEqual([
      250, 0, 0, 250,
    ]);
  });

  it("writes PLC rows that enter and leave the pose moving", () => {
    const compiled = compilePlcAction(sequenceOf(slowFast), context);
    const rows = compiled.timelines[0]!.segments;
    expect(rows.map((row) => row.startTime)).toEqual([0, 800, 3200, 4000, 4400, 5600, 6000]);
    expect(rows[3]?.b).toBeCloseTo(15);
    const blocks = compiled.models[0]!.timeBlockList;
    expect(blocks.map((block) => block.virtualAxis[0]?.passVel)).toEqual([0, 150, 0]);
    expect(blocks[2]?.virtualAxis[0]).toMatchObject({ vel: 356.3 });
  });

  it("checks acceleration against max speed / min accel time instead of phase length", () => {
    // 上限 400 / 1 = 400 mm/s²：慢段 133 合格，快段 (356.25-150)/0.4 = 516 超
    const issues = validateActionSequence(
      sequenceOf(slowFast),
      validationOf({ ...limit, maxVelocity: 400, minAccelTime: 1 }),
    );
    expect(issues.filter((issue) => issue.code === "acceleration-exceeded")).toEqual([
      expect.objectContaining({ segmentKey: "p1->p2" }),
    ]);
    // 段首变速 0.8 s 比最短加减速时间 1 s 短，但加速度够小，不报错
    expect(
      validateActionSequence(
        sequenceOf(slowFast.slice(0, 2)),
        validationOf({ ...limit, maxVelocity: 400, minAccelTime: 1 }),
      ).filter((issue) => issue.severity === "error"),
    ).toEqual([]);
  });

  it("flags a pass speed the span cannot fit", () => {
    const issues = validateActionSequence(
      sequenceOf([slowFast[0]!, pose("p1", 4000, { v1: 400 }, { v1: 1000 }), slowFast[2]!]),
      validationOf(limit),
    );
    expect(issues.find((issue) => issue.code === "pass-speed-infeasible")).toMatchObject({
      segmentKey: "p0->p1",
    });
  });

  it("keeps pass-through values on a span that enters moving", () => {
    const resolved = resolveActionSequence(
      sequenceOf([
        pose("p0", 0, { v1: 0 }),
        pose("p1", 4000, { v1: 400 }),
        pose("p2", 5000, { v2: 0 }),
        pose("p3", 6000, { v1: 1000 }),
      ]),
    );
    const span = segmentAxisMotion(resolved.segments[1]!, "v1");
    expect(span).toMatchObject({ fromRef: "p1", toRef: "p3", startSpeed: 150, endSpeed: 0 });
    expect(resolved.posesByObject.get(1)![2]!.pose.v1).toBeCloseTo(
      evaluateResolvedSequence(resolved, 5000).get(1)!.v1,
    );
  });
});
