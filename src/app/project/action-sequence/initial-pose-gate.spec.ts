import { describe, expect, it } from "vitest";
import { MOTION_DEFAULTS } from "@/app/project/configuration-rules";
import type { ControlledObjectConfig } from "@/app/project/project-document-types";
import type { ActionSequenceConfig, ModelPose } from "./types";
import {
  capturePreparedPoses,
  enabledAxesMatchStart,
  evaluateStartGate,
  preparedPosesMatchTelemetry,
  remainingProgramMs,
} from "./initial-pose-gate";
import { fixtureObjects, fixtureSequence, twoPointFixture } from "./nearest-start.fixture";

const singlePointObject = (
  overrides: Partial<ControlledObjectConfig> = {},
): ControlledObjectConfig => ({
  id: 1,
  name: "O1",
  controlType: 2,
  enabledVirtualAxes: ["v1"],
  shapePreset: "cube",
  shapeDimensions: { width: 1000, height: 1000, depth: 1000 },
  dimensions: { w: 1000, h: 1000, d: 1000 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  pulleyDistance: 0,
  modelRunDirection: 1,
  driveAxes: [{ key: "0" }],
  maxAxisVelocity: 200,
  motionParams: { h: { ...MOTION_DEFAULTS.move } },
  params: {},
  ...overrides,
});

const twoPoseSequence = (
  from: ModelPose,
  to: ModelPose,
  trajectoryMode = false,
): ActionSequenceConfig => ({
  id: 1,
  name: "s",
  trajectoryMode,
  blocks: [
    { id: "a", kind: "pose", objectId: 1, atMs: 0, pose: from },
    { id: "b", kind: "pose", objectId: 1, atMs: 4000, pose: to },
  ],
  segments: [],
});

const instructionSequence = (): ActionSequenceConfig => ({
  id: 1,
  name: "s",
  trajectoryMode: false,
  blocks: [
    {
      id: "i",
      kind: "instruction",
      presetId: "set-enabled",
      objectId: 1,
      atMs: 1000,
      instr: { enabled: true },
    },
  ],
  segments: [],
});

const gate = (
  sequence: ActionSequenceConfig,
  currentH: number,
  options: {
    nearest?: boolean;
    reverse?: boolean;
    object?: ControlledObjectConfig;
    referenceFrameMs?: number;
    specifiedFrameMs?: number;
  } = {},
) =>
  evaluateStartGate({
    sequence,
    objects: [options.object ?? singlePointObject()],
    motors: [],
    telemetryByObjectId: new Map([[1, { h: currentH, p: 40, y: 50 }]]),
    nearest: options.nearest ?? false,
    reverse: options.reverse ?? false,
    ...(options.referenceFrameMs !== undefined ? { referenceFrameMs: options.referenceFrameMs } : {}),
    ...(options.specifiedFrameMs !== undefined ? { specifiedFrameMs: options.specifiedFrameMs } : {}),
  });

/** 上去再回到起点位姿：4000ms 的位姿和 0ms 一样 */
const roundTripSequence = (trajectoryMode: boolean): ActionSequenceConfig => ({
  id: 1,
  name: "s",
  trajectoryMode,
  blocks: [
    { id: "a", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 10, v2: 0, v3: 0 } },
    { id: "b", kind: "pose", objectId: 1, atMs: 2000, pose: { v1: 210, v2: 0, v3: 0 } },
    { id: "c", kind: "pose", objectId: 1, atMs: 4000, pose: { v1: 10, v2: 0, v3: 0 } },
  ],
  segments: [],
});

describe("enabledAxesMatchStart", () => {
  it("accepts 1 mm and 0.1 degree and rejects the next step", () => {
    expect(
      enabledAxesMatchStart(["v1", "v2", "v3"], { h: 11, p: 0.1, y: -0.1 }, { v1: 10, v2: 0, v3: 0 }),
    ).toBe(true);
    expect(enabledAxesMatchStart(["v1"], { h: 11.2, p: 0, y: 0 }, { v1: 10, v2: 0, v3: 0 })).toBe(false);
    expect(enabledAxesMatchStart(["v2"], { h: 0, p: 0.2, y: 0 }, { v1: 0, v2: 0, v3: 0 })).toBe(false);
  });
});

describe("preparedPosesMatchTelemetry", () => {
  const object = singlePointObject();

  it("records member telemetry and accepts the same enabled axes", () => {
    const telemetry = new Map([[1, { h: 10, p: 40, y: 50 }]]);
    const prepared = capturePreparedPoses([1], telemetry);
    expect(prepared).toEqual({ 1: { h: 10, p: 40, y: 50 } });
    expect(preparedPosesMatchTelemetry(prepared, [object], telemetry)).toBe(true);
    expect(
      preparedPosesMatchTelemetry(prepared, [object], new Map([[1, { h: 11, p: 0, y: 0 }]])),
    ).toBe(true);
  });

  it("rejects an enabled axis that left the prepared pose", () => {
    const prepared = { 1: { h: 10, p: 0, y: 0 } };
    expect(
      preparedPosesMatchTelemetry(prepared, [object], new Map([[1, { h: 12, p: 0, y: 0 }]])),
    ).toBe(false);
  });
});

describe("evaluateStartGate", () => {
  const sequence = twoPoseSequence({ v1: 10, v2: 0, v3: 0 }, { v1: 400, v2: 0, v3: 0 });

  it("treats an in-tolerance enabled axis as at-start and keeps the algorithm's small move", () => {
    const result = gate(sequence, 10.5);
    expect(result).toMatchObject({
      status: "at-start",
      plan: { startMode: "at-start", nearest: false, direction: 1, targetFrameMs: 0 },
    });
    if (result.status !== "at-start") return;
    expect(result.plan.members).toHaveLength(1);
    expect(result.plan.members[0]!.axes).toEqual([
      expect.objectContaining({ axis: "v1", from: 10.5, to: 10 }),
    ]);
    expect(result.plan.prepareTimeMs).toBe(Math.ceil(result.plan.transitionSec * 1000));
  });

  it("stays at the first frame with nearest on instead of skipping to the next keyframe", () => {
    expect(gate(sequence, 10, { nearest: true })).toMatchObject({
      status: "at-start",
      plan: { startMode: "at-start", nearest: true, targetFrameMs: 0, transitionSec: 0 },
    });
  });

  it("uses the last frame as the start when reversed", () => {
    expect(gate(sequence, 400, { reverse: true })).toMatchObject({
      status: "at-start",
      plan: { startMode: "at-start", direction: -1, targetFrameMs: 4000, transitionSec: 0 },
    });
    expect(gate(sequence, 10, { reverse: true }).status).toBe("transition");
  });

  it("has nothing to prepare for a sequence without poses", () => {
    expect(gate(instructionSequence(), 0)).toMatchObject({
      status: "at-start",
      plan: { startMode: "at-start", targetFrameMs: 0, prepareTimeMs: 0, members: [] },
    });
  });

  it("returns to the start and adds the transition to the programmed time", () => {
    const result = gate(sequence, 100);
    expect(result.status).toBe("transition");
    if (result.status !== "transition") return;
    expect(result.plan.targetFrameMs).toBe(0);
    expect(result.plan.forced).toBe(false);
    expect(result.programSeconds).toBe(4);
    expect(result.transitionSeconds).toBeGreaterThan(0);
    expect(result.totalSeconds).toBeCloseTo(result.transitionSeconds + 4, 9);
  });

  it("joins at a later keyframe with nearest on, so the total can be shorter", () => {
    const result = gate(sequence, 390, { nearest: true });
    expect(result.status).toBe("transition");
    if (result.status !== "transition") return;
    expect(result.plan.targetFrameMs).toBe(4000);
    expect(result.totalSeconds).toBeCloseTo(result.transitionSeconds, 9);
    expect(result.totalSeconds).toBeLessThan(result.programSeconds);
  });

  it("prepares a forced trajectory from off the curve instead of blocking it", () => {
    const forced = twoPoseSequence({ v1: 10, v2: 0, v3: 0 }, { v1: 400, v2: 0, v3: 0 }, true);
    const result = gate(forced, 100);
    expect(result.status).toBe("transition");
    if (result.status !== "transition") return;
    expect(result.plan.forced).toBe(true);
    expect(result.plan.prepareTimeMs).toBe(Math.ceil(result.transitionSeconds * 1000));
    const [move] = result.plan.members[0]!.axes;
    expect(move).toMatchObject({ axis: "v1", from: 100, to: 10 });
    expect(move!.deceleration).toBe(move!.acceleration);
  });

  it("returns the algorithm error when a member cannot move", () => {
    const result = gate(sequence, 100, { object: singlePointObject({ maxAxisVelocity: 0 }) });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.message).toBe("模型1的最大电机速度必须大于0");
  });

  it("plans the mixed hoist fixture with every member", () => {
    const result = evaluateStartGate({
      sequence: fixtureSequence(false),
      objects: fixtureObjects(),
      motors: [],
      telemetryByObjectId: new Map([[1, { h: 120, p: 0, y: 0 }]]),
      nearest: false,
      reverse: false,
    });
    expect(result.status).toBe("transition");
    if (result.status === "transition") {
      expect(result.plan.members.map((member) => member.objectId)).toEqual([1, 2, 3, 4]);
    }
  });
});

describe("evaluateStartGate from a reference frame (任务卡继续 / 反向回)", () => {
  /** 单调上升：0ms 在 10，4000ms 到 410 */
  const rising = (trajectoryMode: boolean) =>
    twoPoseSequence({ v1: 10, v2: 0, v3: 0 }, { v1: 410, v2: 0, v3: 0 }, trajectoryMode);

  it("does not restart from 0 where the curve passes the start pose again", () => {
    const sequence = roundTripSequence(true);
    // 不给参考帧时停在起点位姿就是从头开始
    expect(gate(sequence, 10, { nearest: true })).toMatchObject({
      status: "at-start",
      plan: { targetFrameMs: 0 },
    });
    expect(gate(sequence, 10, { nearest: true, referenceFrameMs: 4000 })).toMatchObject({
      status: "at-start",
      plan: { startMode: "at-start", nearest: true, direction: 1, targetFrameMs: 4000, transitionSec: 0 },
    });
    expect(gate(sequence, 10, { nearest: true, reverse: true, referenceFrameMs: 4000 })).toMatchObject({
      status: "at-start",
      plan: { direction: -1, targetFrameMs: 4000 },
    });
  });

  it("searches both sides of the reference inside its original segment", () => {
    // 只有一段：当前位置 210 在 2000ms 处，正向参考 3000 也接到 2000，反向参考 1000 也接到 2000
    const sequence = rising(true);
    expect(gate(sequence, 210, { nearest: true, referenceFrameMs: 3000 })).toMatchObject({
      status: "at-start",
      plan: { targetFrameMs: 2000, direction: 1 },
    });
    expect(gate(sequence, 210, { nearest: true, reverse: true, referenceFrameMs: 1000 })).toMatchObject({
      status: "at-start",
      plan: { targetFrameMs: 2000, direction: -1 },
    });
  });

  it("stays in the reference frame's segment instead of the nearest position elsewhere", () => {
    // 往返曲线 0ms、4000ms 都在 10：参考 1000 在 [0, 2000]，接到 0；参考 3000 在 [2000, 4000]，接到 4000
    expect(gate(roundTripSequence(true), 10, { nearest: true, referenceFrameMs: 1000 })).toMatchObject({
      status: "at-start",
      plan: { targetFrameMs: 0 },
    });
    expect(
      gate(roundTripSequence(true), 10, { nearest: true, reverse: true, referenceFrameMs: 3000 }),
    ).toMatchObject({ status: "at-start", plan: { targetFrameMs: 4000, direction: -1 } });
  });

  it("joins the outbound branch of an unequal round trip, not the coarse-grid return", () => {
    // 0→1000 用 1100ms，回到 0 用 1600ms：500 出现在 550ms 和 1900ms
    const unequal: ActionSequenceConfig = {
      id: 1,
      name: "s",
      trajectoryMode: true,
      blocks: [
        { id: "a", kind: "pose", objectId: 1, atMs: 0, pose: { v1: 0, v2: 0, v3: 0 } },
        { id: "b", kind: "pose", objectId: 1, atMs: 1100, pose: { v1: 1000, v2: 0, v3: 0 } },
        { id: "c", kind: "pose", objectId: 1, atMs: 2700, pose: { v1: 0, v2: 0, v3: 0 } },
      ],
      segments: [],
    };
    const object = singlePointObject({ maxAxisVelocity: 3000 });
    expect(gate(unequal, 500, { nearest: true, referenceFrameMs: 0, object })).toMatchObject({
      status: "at-start",
      plan: { targetFrameMs: 550, direction: 1 },
    });
    expect(gate(unequal, 500, { nearest: true, reverse: true, referenceFrameMs: 2700, object })).toMatchObject({
      status: "at-start",
      plan: { targetFrameMs: 1900, direction: -1 },
    });
  });

  it("takes the next keyframe from the reference frame along the direction for a non-forced sequence", () => {
    const sequence = roundTripSequence(false);
    expect(gate(sequence, 210, { nearest: true, referenceFrameMs: 1500 })).toMatchObject({
      status: "at-start",
      plan: { targetFrameMs: 2000, direction: 1 },
    });
    expect(gate(sequence, 10, { nearest: true, reverse: true, referenceFrameMs: 1500 })).toMatchObject({
      status: "at-start",
      plan: { targetFrameMs: 0, direction: -1 },
    });
  });

  it("rounds the frame and keeps it inside the action instead of failing", () => {
    const sequence = roundTripSequence(true);
    // 1999.6 取整到 2000，正向归右段 [2000, 4000]；1999.4 取整到 1999，还在 [0, 2000]
    expect(gate(sequence, 10, { nearest: true, referenceFrameMs: 1999.6 })).toMatchObject({ plan: { targetFrameMs: 4000 } });
    expect(gate(sequence, 10, { nearest: true, referenceFrameMs: 1999.4 })).toMatchObject({ plan: { targetFrameMs: 0 } });
    expect(gate(sequence, 10, { nearest: true, referenceFrameMs: 99999 })).toMatchObject({
      status: "at-start",
      plan: { targetFrameMs: 4000 },
    });
    expect(gate(sequence, 10, { nearest: true, reverse: true, referenceFrameMs: -5 })).toMatchObject({
      status: "at-start",
      plan: { targetFrameMs: 0 },
    });
  });

  it("ignores the frame without nearest", () => {
    expect(gate(roundTripSequence(true), 10, { referenceFrameMs: 4000 })).toMatchObject({
      status: "at-start",
      plan: { targetFrameMs: 0, nearest: false },
    });
  });
});

describe("evaluateStartGate mid-curve starts", () => {
  it("flags an at-start plan that does not begin at the run direction's start", () => {
    const sequence = twoPoseSequence({ v1: 10, v2: 0, v3: 0 }, { v1: 410, v2: 0, v3: 0 }, true);
    expect(gate(sequence, 10, { nearest: true })).toMatchObject({ status: "at-start", midCurve: false });
    expect(gate(sequence, 410, { reverse: true })).toMatchObject({ status: "at-start", midCurve: false });
    // 停在曲线中间：就近接在 2000ms，不用过渡但跳过前半段
    expect(gate(sequence, 210, { nearest: true })).toMatchObject({
      status: "at-start",
      midCurve: true,
      programSeconds: 4,
      plan: { targetFrameMs: 2000 },
    });
  });
});

describe("evaluateStartGate from a specified frame", () => {
  const rising = (trajectoryMode: boolean) =>
    twoPoseSequence({ v1: 10, v2: 0, v3: 0 }, { v1: 410, v2: 0, v3: 0 }, trajectoryMode);

  it("starts a forced trajectory exactly at the frame, also when the members sit at the start", () => {
    const result = gate(rising(true), 10, { specifiedFrameMs: 1500 });
    expect(result).toMatchObject({
      status: "transition",
      plan: { targetFrameMs: 1500, nearest: true, startMode: "nearest" },
    });
    if (result.status !== "transition") return;
    // 梯形速度曲线：1500ms 在前半程，位置在起点和中点（2000ms 的 210）之间
    const [move] = result.plan.members[0]!.axes;
    expect(move).toMatchObject({ axis: "v1", from: 10 });
    expect(move!.to).toBeGreaterThan(10);
    expect(move!.to).toBeLessThan(210);
  });

  it("wins over nearest and the reference frame", () => {
    expect(
      gate(rising(true), 210, { nearest: true, referenceFrameMs: 3000, specifiedFrameMs: 500 }),
    ).toMatchObject({ status: "transition", plan: { targetFrameMs: 500 } });
  });

  it("is at-start mid-curve when the members already sit on the frame", () => {
    expect(gate(rising(true), 210, { specifiedFrameMs: 2000 })).toMatchObject({
      status: "at-start",
      midCurve: true,
      plan: { targetFrameMs: 2000, startMode: "at-start", nearest: true },
    });
  });

  it("joins a non-forced action at the nearest keyframe from the frame along the direction", () => {
    const sequence = roundTripSequence(false);
    expect(gate(sequence, 210, { specifiedFrameMs: 500 })).toMatchObject({ plan: { targetFrameMs: 2000 } });
    expect(gate(sequence, 210, { specifiedFrameMs: 2000 })).toMatchObject({
      status: "at-start",
      plan: { targetFrameMs: 2000 },
    });
    expect(gate(sequence, 10, { reverse: true, specifiedFrameMs: 3000 })).toMatchObject({
      plan: { targetFrameMs: 0, direction: -1 },
    });
  });

  it("keeps an out-of-range frame inside the action", () => {
    expect(gate(rising(true), 10, { specifiedFrameMs: 99999 })).toMatchObject({ plan: { targetFrameMs: 4000 } });
  });
});

describe("remainingProgramMs", () => {
  it("counts forward to the end and backward to zero", () => {
    const base = { direction: 1 as const, targetFrameMs: 3000 };
    expect(remainingProgramMs({ ...base } as never, 10000)).toBe(7000);
    expect(remainingProgramMs({ ...base, direction: -1 } as never, 10000)).toBe(3000);
  });
});

describe("axes the sequence never sets", () => {
  // 两点摆只动升降，摆动轴在所有位姿上都不设定
  const liftOnly: ActionSequenceConfig = {
    id: 1,
    name: "lift",
    trajectoryMode: false,
    blocks: [
      { id: "a", kind: "pose", objectId: 2, atMs: 0, pose: { v1: 10 } },
      { id: "b", kind: "pose", objectId: 2, atMs: 4000, pose: { v1: 400 } },
    ],
    segments: [],
  };
  const gateAt = (h: number, p: number) =>
    evaluateStartGate({
      sequence: liftOnly,
      objects: [twoPointFixture()],
      motors: [],
      telemetryByObjectId: new Map([[2, { h, p, y: 0 }]]),
      nearest: false,
      reverse: false,
    });

  it("does not require the free axis at a start value", () => {
    expect(gateAt(10, 7)).toMatchObject({ status: "at-start" });
  });

  it("leaves the free axis where it is during the start transition", () => {
    const result = gateAt(200, 7);
    expect(result.status).toBe("transition");
    if (result.status !== "transition") return;
    const axes = result.plan.members.flatMap((member) => member.axes.map((move) => move.axis));
    expect(axes).toEqual(["v1"]);
  });
});
