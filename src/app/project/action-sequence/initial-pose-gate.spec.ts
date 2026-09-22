import { describe, expect, it, vi } from "vitest";
import { MOTION_DEFAULTS } from "@/app/project/configuration-rules";
import type {
  ControlledObjectConfig,
  MotorConfig,
} from "@/app/project/project-document-types";
import type { ActionSequenceConfig, ModelPose } from "./types";
import * as initialTransitionPlanner from "./initial-transition-planner";
import {
  enabledAxesMatchStart,
  evaluateInitialPoseGate,
  type PoseSpeedMode,
} from "./initial-pose-gate";

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

const poseSequence = (pose: ModelPose): ActionSequenceConfig => ({
  id: 1,
  name: "s",
  trajectoryMode: false,
  blocks: [{ id: "p", kind: "pose", objectId: 1, atMs: 2000, pose }],
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

const evaluate = (
  pose: ModelPose,
  currentH: number,
  speedMode: PoseSpeedMode = "default",
  object: ControlledObjectConfig = singlePointObject(),
  motors: MotorConfig[] = [],
) =>
  evaluateInitialPoseGate({
    sequence: poseSequence(pose),
    objects: [object],
    motors,
    telemetryByObjectId: new Map([[1, { h: currentH, p: 40, y: 50 }]]),
    speedMode,
    sequenceDurationMs: 2000,
  });

describe("enabledAxesMatchStart", () => {
  it("accepts 1 mm and 0.1 degree and rejects the next step", () => {
    expect(
      enabledAxesMatchStart(["v1", "v2", "v3"], { h: 11, p: 0.1, y: -0.1 }, { v1: 10, v2: 0, v3: 0 }),
    ).toBe(true);
    expect(
      enabledAxesMatchStart(["v1"], { h: 11.2, p: 0, y: 0 }, { v1: 10, v2: 0, v3: 0 }),
    ).toBe(false);
    expect(
      enabledAxesMatchStart(["v2"], { h: 0, p: 0.2, y: 0 }, { v1: 0, v2: 0, v3: 0 }),
    ).toBe(false);
  });
});

describe("evaluateInitialPoseGate", () => {
  it("treats an in-tolerance enabled axis as at-start and does not plan", () => {
    const spy = vi.spyOn(initialTransitionPlanner, "planInitialTransition");
    expect(evaluate({ v1: 10, v2: 0, v3: 0 }, 10.5)).toEqual({ status: "at-start" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("ignores a disabled axis that is far from the start pose", () => {
    const spy = vi.spyOn(initialTransitionPlanner, "planInitialTransition");
    expect(evaluate({ v1: 10, v2: 0, v3: 0 }, 10)).toEqual({ status: "at-start" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("skips a member that has no start pose", () => {
    const spy = vi.spyOn(initialTransitionPlanner, "planInitialTransition");
    expect(
      evaluateInitialPoseGate({
        sequence: instructionSequence(),
        objects: [singlePointObject()],
        motors: [],
        telemetryByObjectId: new Map([[1, { h: 0, p: 0, y: 0 }]]),
        speedMode: "default",
        sequenceDurationMs: 2000,
      }),
    ).toEqual({ status: "at-start" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("plans with default motion params when the enabled axis is outside tolerance", () => {
    const spy = vi.spyOn(initialTransitionPlanner, "planInitialTransition");
    const result = evaluate({ v1: 100, v2: 0, v3: 0 }, 0, "default");
    expect(result.status).toBe("transition");
    const model = spy.mock.calls[0]?.[0][0];
    expect(model).toMatchObject({
      type: 1,
      id: 1,
      current: { h: 0 },
      target: { h: 100 },
      h: { velocity: 50, acceleration: 25, deceleration: 25 },
      maxMotorVelocity: 200,
    });
    if (result.status === "transition") {
      expect(result.extraSeconds).toBe(result.plan.totalTime);
      expect(result.totalSeconds).toBe(result.plan.totalTime + 2);
      expect(result.plan.totalTime).toBeGreaterThan(0);
    }
    spy.mockRestore();
  });

  it("uses axis max velocity and min accel time for the fastest mode", () => {
    const spy = vi.spyOn(initialTransitionPlanner, "planInitialTransition");
    evaluate({ v1: 100, v2: 0, v3: 0 }, 0, "fastest");
    expect(spy.mock.calls[0]?.[0][0]).toMatchObject({
      h: { velocity: 500, acceleration: 500, deceleration: 500 },
    });
    spy.mockRestore();
  });

  it("returns the planner error and no plan when motor velocity is not positive", () => {
    const result = evaluate(
      { v1: 100, v2: 0, v3: 0 },
      0,
      "default",
      singlePointObject({ maxAxisVelocity: 0 }),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toMatch(/max motor velocity/);
      expect(result).not.toHaveProperty("plan");
    }
  });

  it("builds a two-point model from mounts and pulley distance", () => {
    const spy = vi.spyOn(initialTransitionPlanner, "planInitialTransition");
    const object = singlePointObject({
      controlType: 6,
      enabledVirtualAxes: ["v1", "v2"],
      pulleyDistance: 100,
      modelRunDirection: 1,
      pDefaultMaxVelocity: 3,
      driveAxes: [
        { key: "0", mount: { x: 0, z: 0 } },
        { key: "1", mount: { x: 2000, z: 0 } },
      ],
      motionParams: {
        move: { ...MOTION_DEFAULTS.move },
        swingX: { ...MOTION_DEFAULTS.swingX },
      },
    });
    evaluateInitialPoseGate({
      sequence: poseSequence({ v1: 500, v2: 10, v3: 0 }),
      objects: [object],
      motors: [],
      telemetryByObjectId: new Map([[1, { h: 1000, p: 0, y: 0 }]]),
      speedMode: "default",
      sequenceDurationMs: 0,
    });
    expect(spy.mock.calls[0]?.[0][0]).toMatchObject({
      type: 2,
      baseHeight1: 100,
      baseHeight2: 0,
      lengthInside: 2000,
      maxHeight: 1000,
    });
    spy.mockRestore();
  });
});
