import { describe, expect, it } from "vitest";
import { axisMotionValueAt } from "@/app/project/action-sequence/axis-motion";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig, PoseBlock } from "@/app/project/action-sequence/types";
import {
  availableCurveAxes,
  buildAxisCurves,
  curveIssueShortText,
  curveIssueText,
  curveRowObjectIds,
  curveSampleAt,
  dragValueStep,
  fitCurveScales,
  niceTicks,
  roundDragValue,
  spanSampleTimes,
  visibleCurveObjectIds,
} from "./curve-data";
import type { ControlledObject } from "./timeline-data";

const pose = (id: string, objectId: number, atMs: number, values: PoseBlock["pose"], extra: Partial<PoseBlock> = {}): PoseBlock => ({
  id,
  kind: "pose",
  objectId,
  atMs,
  pose: values,
  ...extra,
});

const sequenceOf = (blocks: ActionSequenceConfig["blocks"]): ActionSequenceConfig => ({
  id: 1,
  name: "Seq",
  trajectoryMode: false,
  blocks,
  segments: [],
});

const lift = (id: number, maxSpeed = 2000): ControlledObject => ({
  id,
  name: `升降台 ${id}`,
  currentPosition: 0,
  unit: "mm",
  axisLabel: "",
  enabled: true,
  enabledAxes: ["v1"],
  controlType: "singlePointMove",
  maxSpeedByAxis: { v1: maxSpeed },
  minAccelTimeByAxis: { v1: 0.1 },
  rangeByAxis: { v1: { min: 0, max: 3000 } },
});

// 0 → 1000 → 2000 一路向上（1000 处经过），再回到 500（2000 处折返）
const upAndBack = sequenceOf([
  pose("p0", 7, 0, { v1: 0 }),
  pose("p1", 7, 2000, { v1: 1000 }),
  pose("p2", 7, 4000, { v1: 2000 }),
  pose("p3", 7, 6000, { v1: 500 }),
]);

const curvesOf = (
  sequence: ActionSequenceConfig,
  objects: ControlledObject[] = [lift(7)],
  axis: "v1" | "v2" | "v3" = "v1",
) =>
  buildAxisCurves({
    resolved: resolveActionSequence(sequence),
    objectIds: curveRowObjectIds(sequence),
    axis,
    objects,
  });

describe("buildAxisCurves", () => {
  it("follows the resolved axis motions with keys and junction speeds", () => {
    const [curve] = curvesOf(upAndBack);
    expect(curve).toMatchObject({ objectId: 7, axis: "v1", startMs: 0, endMs: 6000, firstValue: 0, lastValue: 500 });
    expect(curve!.spans.map((span) => [span.motion.fromRef, span.motion.toRef])).toEqual([
      ["p0", "p1"],
      ["p1", "p2"],
      ["p2", "p3"],
    ]);
    expect(curve!.keys.map((key) => [key.blockId, key.kind, key.value])).toEqual([
      ["p0", "set", 0],
      ["p1", "set", 1000],
      ["p2", "set", 2000],
      ["p3", "set", 500],
    ]);
    // 1000 处前后平均速度都是 500，调和平均 500；折返处为 0；下行段的速度为负
    expect(curve!.junctions.map((junction) => [junction.sourceRef, junction.kind, junction.velocity])).toEqual([
      ["p0", "edge", 0],
      ["p1", "auto", 500],
      ["p2", "reverse", 0],
      ["p3", "edge", 0],
    ]);
    expect(curve!.spans.every((span) => span.drawable && span.issues.length === 0)).toBe(true);
  });

  it("samples the same position as the motion and holds before the first and after the last pose", () => {
    const [curve] = curvesOf(upAndBack);
    const first = curve!.spans[0]!;
    expect(curveSampleAt(curve!, -500)).toEqual({ value: 0, velocity: 0 });
    expect(curveSampleAt(curve!, 1000).value).toBeCloseTo(axisMotionValueAt(first.motion, 1000), 9);
    // 经过处带着衔接速度进下一段
    expect(curveSampleAt(curve!, 2000).velocity).toBeCloseTo(500, 9);
    expect(curveSampleAt(curve!, 5000).velocity).toBeLessThan(0);
    expect(curveSampleAt(curve!, 9000)).toEqual({ value: 500, velocity: 0 });
  });

  it("marks a pose that leaves the axis unset as a pass-through point without a junction", () => {
    const [curve] = curvesOf(
      sequenceOf([
        pose("a", 7, 0, { v1: 0, v2: 0 }),
        pose("b", 7, 1000, { v2: 5 }),
        pose("c", 7, 2000, { v1: 1000, v2: 0 }),
      ]),
      [{ ...lift(7), enabledAxes: ["v1", "v2"] }],
    );
    expect(curve!.keys.map((key) => [key.blockId, key.kind])).toEqual([
      ["a", "set"],
      ["b", "pass"],
      ["c", "set"],
    ]);
    expect(curve!.spans).toHaveLength(1);
    expect(curve!.junctions.map((junction) => junction.sourceRef)).toEqual(["a", "c"]);
    expect(curve!.keys[1]!.value).toBeCloseTo(curveSampleAt(curve!, 1000).value, 9);
  });

  it("skips axes the object does not have or the sequence never sets", () => {
    const sequence = sequenceOf([pose("a", 7, 0, { v1: 0 }), pose("b", 7, 1000, { v1: 100 })]);
    expect(curvesOf(sequence, [lift(7)], "v2")).toEqual([]);
    expect(curvesOf(sequence, [{ ...lift(7), enabledAxes: ["v1", "v2"] }], "v2")).toEqual([]);
    expect(
      availableCurveAxes(resolveActionSequence(sequence), [7], [{ ...lift(7), enabledAxes: ["v1", "v2"] }]),
    ).toEqual(["v1"]);
  });

  it("flags spans with the same rules as sequence validation", () => {
    const [curve] = curvesOf(upAndBack, [lift(7, 600)]);
    const [toFirst, toSecond, back] = curve!.spans;
    expect(toFirst!.issues).toEqual([]);
    expect(toSecond!.issues).toEqual([]);
    expect(back!.issues).toEqual([
      { code: "limit-exceeded", value: expect.closeTo(937.5, 6), limit: 600 },
    ]);
    const format = { speed: (value: number) => `${Math.round(value)} mm/s`, acceleration: String };
    expect(curveIssueText(back!.issues[0]!, format)).toBe("峰值速度 938 mm/s 超过上限 600 mm/s");
    expect(curveIssueShortText(back!.issues[0]!, (value) => String(Math.round(value)))).toBe("超速 938");
  });

  it("draws a span it cannot shape as a straight line and reports why", () => {
    const sequence = sequenceOf([
      pose("p0", 7, 0, { v1: 0 }),
      pose("p1", 7, 2000, { v1: 1000 }, { passSpeeds: { v1: 5000 } }),
      pose("p2", 7, 4000, { v1: 2000 }),
    ]);
    const [curve] = curvesOf(sequence);
    const [first] = curve!.spans;
    expect(first!.drawable).toBe(false);
    expect(first!.issues).toEqual([{ code: "pass-speed-infeasible" }]);
    const middle = curveSampleAt(curve!, 1000);
    expect(middle.value).toBeCloseTo(500, 9);
    expect(middle.velocity).toBeNaN();
  });
});

describe("spanSampleTimes", () => {
  it("keeps both ends and the phase corners and fills the visible part", () => {
    const [curve] = curvesOf(upAndBack);
    const first = curve!.spans[0]!;
    const times = spanSampleTimes(first, 0, 10_000, 500);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBe(2000);
    for (const corner of first.cornersMs) expect(times).toContain(corner);
    expect(times).toContain(1000);
    expect([...times].sort((left, right) => left - right)).toEqual(times);
    expect(spanSampleTimes(first, 500, 900, 100)).toEqual([500, 600, 700, 800, 900]);
    expect(spanSampleTimes(first, 3000, 4000, 100)).toEqual([]);
  });

  it("only needs the ends of a hold", () => {
    const [curve] = curvesOf(
      sequenceOf([pose("a", 7, 0, { v1: 100 }), pose("b", 7, 2000, { v1: 100 })]),
    );
    expect(spanSampleTimes(curve!.spans[0]!, 0, 2000, 100)).toEqual([0, 2000]);
  });
});

describe("fitCurveScales", () => {
  it("pads the positions and keeps zero speed in view", () => {
    const scales = fitCurveScales(curvesOf(upAndBack));
    expect(scales.position.min).toBeLessThan(0);
    expect(scales.position.max).toBeGreaterThan(2000);
    expect(scales.velocity.min).toBeLessThan(-900);
    expect(scales.velocity.max).toBeGreaterThan(500);
  });

  it("includes a nearby speed limit so its line shows how close the motion gets", () => {
    // 上行峰值 562.5、下行 937.5：上限 1000 只离下行近
    const oneSide = fitCurveScales(curvesOf(upAndBack, [lift(7, 1000)]));
    expect(oneSide.velocity.min).toBeLessThan(-1000);
    expect(oneSide.velocity.max).toBeLessThan(1000);
    const bothSides = fitCurveScales(curvesOf(upAndBack, [lift(7, 800)]));
    expect(bothSides.velocity.max).toBeGreaterThan(800);
    const far = fitCurveScales(curvesOf(upAndBack, [lift(7, 10_000)]));
    expect(far.velocity.min).toBeGreaterThan(-10_000);
  });

  it("falls back to a unit range without curves", () => {
    expect(fitCurveScales([])).toEqual({
      position: { min: -1, max: 1 },
      velocity: { min: -1, max: 1 },
    });
  });
});

describe("curve helpers", () => {
  it("shows the selected objects of the sequence, or all of them when none is selected", () => {
    expect(visibleCurveObjectIds([7, 8, 9], [8, 12])).toEqual([8]);
    expect(visibleCurveObjectIds([7, 8, 9], [12])).toEqual([7, 8, 9]);
    expect(visibleCurveObjectIds([7, 8, 9], [])).toEqual([7, 8, 9]);
  });

  it("picks round ticks", () => {
    expect(niceTicks(-250, 2750, 4)).toEqual([0, 1000, 2000]);
    expect(niceTicks(-835, 690, 4)).toEqual([-500, 0, 500]);
    expect(niceTicks(0.05, 0.42, 4)).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(niceTicks(0.05, 0.42, 3)).toEqual([0.2, 0.4]);
    expect(niceTicks(5, 5, 3)).toEqual([]);
  });

  it("rounds dragged values to a step no finer than a pixel or the project precision", () => {
    expect(dragValueStep(25.9)).toBe(20);
    expect(dragValueStep(0.37)).toBe(0.2);
    expect(dragValueStep(0.05)).toBe(0.1);
    expect(roundDragValue(1234.5, 20)).toBe(1240);
    expect(roundDragValue(0.30000000000000004, 0.1)).toBe(0.3);
  });
});
