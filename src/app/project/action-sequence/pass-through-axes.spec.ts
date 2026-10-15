import { describe, expect, it } from "vitest";
import { compilePlcAction } from "./compile-plc-action";
import { axisMotionVelocityAt, evaluateResolvedSequence } from "./evaluate-sequence";
import {
  pinUncontrolledAxes,
  reconcileSegmentConfigs,
  resolveActionSequence,
  segmentAxisMotion,
} from "./resolve-sequence";
import type { ActionSequenceConfig, KeyframePose, PoseBlock } from "./types";
import { invalidTimelineTargets, validateActionSequence, type AxisLimit } from "./validate-sequence";

const pose = (id: string, atMs: number, value: KeyframePose): PoseBlock => ({
  id,
  kind: "pose",
  objectId: 1,
  atMs,
  pose: value,
});

const sequenceOf = (blocks: PoseBlock[], extra?: Partial<ActionSequenceConfig>): ActionSequenceConfig => ({
  id: 1,
  name: "wave",
  trajectoryMode: false,
  blocks,
  segments: [],
  ...extra,
});

const limit: AxisLimit = { min: -1e6, max: 1e6, maxVelocity: 1e6, minAccelTime: 0.001 };
const context = {
  objects: [{ id: 1, enabledVirtualAxes: ["v1", "v2"] as const, limits: { v1: limit, v2: limit } }],
};
const validationContext = {
  objects: [{ id: 1, enabledVirtualAxes: ["v1", "v2"] as ("v1" | "v2")[], limits: { v1: limit, v2: limit } }],
};

// 虚轴1 0–4s 升到 1000，虚轴2 2–6s 升到 1000，中间两帧各有一个轴经过
const wave = sequenceOf([
  pose("p0", 0, { v1: 0, v2: 0, v3: 0 }),
  pose("p1", 2000, { v2: 0 }),
  pose("p2", 4000, { v1: 1000 }),
  pose("p3", 6000, { v2: 1000 }),
]);

describe("pose axes left unset", () => {
  it("fills pass-through values from the curve between the set values", () => {
    const resolved = resolveActionSequence(wave);
    const series = resolved.posesByObject.get(1)!;
    expect(series.map((point) => point.pose)).toEqual([
      { v1: 0, v2: 0, v3: 0 },
      { v1: 500, v2: 0, v3: 0 },
      { v1: 1000, v2: 500, v3: 0 },
      { v1: 1000, v2: 1000, v3: 0 },
    ]);
    expect(series[1]?.unsetAxes).toEqual(["v1", "v3"]);
    expect(series[0]?.unsetAxes).toBeUndefined();
  });

  it("lets an unset axis follow one curve across the pose instead of stopping", () => {
    const resolved = resolveActionSequence(wave);
    const [first, second] = resolved.segments;
    const v1 = segmentAxisMotion(first!, "v1");
    expect(v1).toMatchObject({ fromRef: "p0", toRef: "p2", from: 0, to: 1000, durationMs: 4000 });
    expect(v1.segmentKeys).toEqual(["p0->p1", "p1->p2"]);
    expect(segmentAxisMotion(second!, "v1")).toBe(v1);
    // 经过 p1 时虚轴1 正在匀速段，不减速到 0
    expect(axisMotionVelocityAt(v1, 2000)).toBeCloseTo(312.5);
    expect(evaluateResolvedSequence(resolved, 3000).get(1)).toMatchObject({ v1: 812.5, v2: 187.5 });
  });

  it("writes one PLC curve per axis span and null for unset axes in the C++ blocks", () => {
    const compiled = compilePlcAction(wave, context);
    const v1 = compiled.timelines.find((timeline) => timeline.virtualAxisNo === 1)!;
    const v2 = compiled.timelines.find((timeline) => timeline.virtualAxisNo === 2)!;
    expect(v1.segments.map((segment) => segment.startTime)).toEqual([0, 800, 3200, 4000, 6000]);
    expect(v2.segments.map((segment) => segment.startTime)).toEqual([0, 2000, 2800, 5200, 6000]);

    const blocks = compiled.models[0]!.timeBlockList;
    expect(blocks.map((block) => block.time)).toEqual([0, 2000, 4000, 6000]);
    expect(blocks[1]?.virtualAxis).toEqual([null, { pos: 0, vel: 0, accVel: 0, decVel: 0 }]);
    expect(blocks[2]?.virtualAxis[0]).toMatchObject({ pos: 1000, vel: 312.5 });
    expect(blocks[2]?.virtualAxis[1]).toBeNull();
    expect(blocks[3]?.virtualAxis[0]).toBeNull();
    expect(blocks[3]?.virtualAxis[1]).toMatchObject({ pos: 1000, vel: 312.5 });
  });

  it("keeps a segment setting for each span and idles the axes a band no longer drives", () => {
    const resolved = resolveActionSequence(wave);
    const configs = reconcileSegmentConfigs(resolved.segments, []);
    const byKey = new Map(configs.map((config) => [`${config.fromRef}->${config.toRef}`, config]));
    expect([...byKey.keys()]).toEqual(["p0->p1", "p0->p2", "p1->p2", "p1->p3", "p2->p3"]);
    expect(byKey.get("p0->p2")?.settings.profiles.v1.kind).toBe("trapezoid");
    expect(byKey.get("p1->p3")?.settings.profiles.v2.kind).toBe("trapezoid");
    expect(byKey.get("p1->p2")?.settings.profiles.v1.kind).toBe("idle");
    expect(byKey.get("p1->p2")?.settings.profiles.v2.kind).toBe("idle");

    const edited = sequenceOf(wave.blocks, {
      segments: configs.map((config) =>
        config.fromRef === "p0" && config.toRef === "p2"
          ? {
              ...config,
              settings: {
                profiles: {
                  ...config.settings.profiles,
                  v1: { kind: "trapezoid", params: { accelMs: 1500, decelMs: 1500 } },
                },
              },
            }
          : config,
      ),
    });
    const pass = resolveActionSequence(edited).posesByObject.get(1)![1]!;
    // 整段曲线的设置决定经过值和每个区间里的运动
    expect(pass.pose.v1).toBeCloseTo(500);
    expect(segmentAxisMotion(resolveActionSequence(edited).segments[1]!, "v1").profile).toEqual({
      kind: "trapezoid",
      params: { accelMs: 1500, decelMs: 1500 },
    });
    expect(
      validateActionSequence(edited, validationContext).filter((issue) => issue.severity === "error"),
    ).toEqual([]);
  });

  it("flags a pose with nothing set", () => {
    const issues = validateActionSequence(
      sequenceOf([pose("a", 0, { v1: 0 }), pose("b", 1000, { v3: 5 }), pose("c", 2000, { v1: 10 })]),
      validationContext,
    );
    expect(issues.filter((issue) => issue.code === "unset-axis")).toEqual([
      expect.objectContaining({ message: "pose has no axis set", blockId: "b" }),
    ]);
  });

  it("leaves an axis never set uncontrolled: no curve, null in every block, no limit check", () => {
    const liftOnly = sequenceOf([pose("a", 0, { v1: 0 }), pose("b", 2000, { v1: 500 })]);
    const resolved = resolveActionSequence(liftOnly);
    expect(resolved.uncontrolledAxesByObject?.get(1)).toEqual(["v2", "v3"]);

    const compiled = compilePlcAction(liftOnly, context);
    expect(compiled.timelines.map((timeline) => timeline.virtualAxisNo)).toEqual([1]);
    expect(compiled.models[0]!.timeBlockList.map((block) => block.virtualAxis[1])).toEqual([null, null]);

    // 占位值 0 不在虚轴2 行程内，也不报超限
    const narrow = {
      objects: [
        {
          id: 1,
          enabledVirtualAxes: ["v1", "v2"] as ("v1" | "v2")[],
          limits: { v1: limit, v2: { ...limit, min: 10, max: 20 } },
        },
      ],
    };
    expect(validateActionSequence(liftOnly, narrow).filter((issue) => issue.severity === "error")).toEqual(
      [],
    );
  });

  it("pins uncontrolled axes to a given position for previews and start plans", () => {
    const resolved = resolveActionSequence(
      sequenceOf([pose("a", 0, { v1: 0 }), pose("b", 2000, { v1: 500 })]),
    );
    const pinned = pinUncontrolledAxes(resolved, (_objectId, axis) => (axis === "v2" ? 7 : undefined));
    expect(evaluateResolvedSequence(pinned, 1000).get(1)).toMatchObject({ v1: 250, v2: 7, v3: 0 });
    expect(pinned.initialPoseByObject.get(1)?.pose).toEqual({ v1: 0, v2: 7, v3: 0 });
    expect(segmentAxisMotion(pinned.segments[0]!, "v2")).toMatchObject({ from: 7, to: 7 });
    // 原解析结果不被改动
    expect(resolved.initialPoseByObject.get(1)?.pose.v2).toBe(0);
  });

  it("reports a span problem on every band the span covers", () => {
    const slow = {
      objects: [
        {
          id: 1,
          enabledVirtualAxes: ["v1", "v2"] as ("v1" | "v2")[],
          limits: { v1: { ...limit, maxVelocity: 100 }, v2: limit },
        },
      ],
    };
    const issues = validateActionSequence(wave, slow);
    const tooFast = issues.find((issue) => issue.code === "limit-exceeded");
    expect(tooFast).toMatchObject({ segmentKey: "p0->p1", segmentKeys: ["p0->p1", "p1->p2"] });
    expect([...invalidTimelineTargets(issues).segmentKeys]).toEqual(["p0->p1", "p1->p2"]);
  });
});
