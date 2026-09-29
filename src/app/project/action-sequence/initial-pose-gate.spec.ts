import { describe, expect, it } from "vitest";
import { MOTION_DEFAULTS } from "@/app/project/configuration-rules";
import type { ControlledObjectConfig } from "@/app/project/project-document-types";
import type { ActionSequenceConfig, ModelPose } from "./types";
import {
  capturePreparedPoses,
  enabledAxesMatchStart,
  evaluateStartGate,
  FORCED_UNSAFE_MESSAGE,
  preparedPosesMatchTelemetry,
  remainingProgramMs,
} from "./initial-pose-gate";
import { fixtureObjects, fixtureSequence } from "./nearest-start.fixture";

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
  motionParams: { move: { ...MOTION_DEFAULTS.move } },
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
  options: { nearest?: boolean; reverse?: boolean; object?: ControlledObjectConfig } = {},
) =>
  evaluateStartGate({
    sequence,
    objects: [options.object ?? singlePointObject()],
    motors: [],
    telemetryByObjectId: new Map([[1, { h: currentH, p: 40, y: 50 }]]),
    nearest: options.nearest ?? false,
    reverse: options.reverse ?? false,
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

  it("treats an in-tolerance enabled axis as at-start even with nearest on", () => {
    expect(gate(sequence, 10.5)).toMatchObject({
      status: "at-start",
      plan: {
        startMode: "at-start",
        nearest: false,
        direction: 1,
        targetFrameMs: 0,
        transitionSec: 0,
        xSafe: null,
        motorLimitScale: null,
        members: [],
      },
    });
    expect(gate(sequence, 10.5, { nearest: true })).toMatchObject({
      status: "at-start",
      plan: { startMode: "at-start", nearest: true, targetFrameMs: 0, members: [] },
    });
  });

  it("uses the last frame as the start when reversed", () => {
    expect(gate(sequence, 400, { reverse: true })).toMatchObject({
      status: "at-start",
      plan: {
        startMode: "at-start",
        direction: -1,
        targetFrameMs: 4000,
        transitionSec: 0,
        members: [],
      },
    });
    expect(gate(sequence, 10, { reverse: true }).status).toBe("transition");
  });

  it("skips a member that has no pose", () => {
    expect(gate(instructionSequence(), 0)).toMatchObject({
      status: "at-start",
      plan: { startMode: "at-start", targetFrameMs: 0, members: [] },
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

  it("blocks ready for a forced trajectory whose xSafe check fails", () => {
    const forced = twoPoseSequence({ v1: 10, v2: 0, v3: 0 }, { v1: 400, v2: 0, v3: 0 }, true);
    const result = gate(forced, 100);
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.message).toBe(FORCED_UNSAFE_MESSAGE);
    expect(result.plan.xSafe).toBe(false);
    expect(result.transitionSeconds).toBeGreaterThan(0);
  });

  it("returns the algorithm error when a member cannot move", () => {
    const result = gate(sequence, 100, { object: singlePointObject({ maxAxisVelocity: 0 }) });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.message).toMatch(/最大电机速度必须为有限正数/);
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

describe("remainingProgramMs", () => {
  it("counts forward to the end and backward to zero", () => {
    const base = { direction: 1 as const, targetFrameMs: 3000 };
    expect(remainingProgramMs({ ...base } as never, 10000)).toBe(7000);
    expect(remainingProgramMs({ ...base, direction: -1 } as never, 10000)).toBe(3000);
  });
});
