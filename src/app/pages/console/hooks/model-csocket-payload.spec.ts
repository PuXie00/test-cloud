import { describe, expect, it } from "vitest";
import type { ControlledObject } from "../components/right-sidebar/config-wizard/config-wizard-types";
import type { MotionAxisParams } from "@/app/project/configuration-types";
import { buildModelParamPayload } from "./model-csocket-payload";

const axisParams = (overrides: Partial<MotionAxisParams> = {}): MotionAxisParams => ({
  minAngle: 0,
  maxAngle: 1000,
  speed: 50,
  accelTime: 2,
  minAccelTime: 1,
  emergencyDecelTime: 0.1,
  acceleration: 25,
  deceleration: 25,
  maxAcceleration: 50,
  maxDeceleration: 50,
  abnormalDeceleration: 500,
  ...overrides,
});

const baseObject: ControlledObject = {
  id: 42,
  name: "Fixture Object",
  controlType: "singlePointMove",
  shapePreset: "cube",
  shapeDimensions: { width: 1000, height: 1000, depth: 1000 },
  dimensions: { w: 1000, h: 1000, d: 1000 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  motionParams: { move: axisParams() },
  maxAxisVelocity: 200,
  pulleyDistance: 0,
  modelRunDirection: 1,
  axes: [{ key: "0", custom: false, mount: { x: 0, z: 0 } }],
  params: {},
};

const multiPointObject: ControlledObject = {
  ...baseObject,
  controlType: "multiPointSwing",
  pMaxVelocity: 4,
  yMaxVelocity: 5,
  safetyRadius: 1500,
  initialTiltDirection: 90,
  motionParams: {
    move: axisParams({ maxAngle: 800, minAngle: 10, speed: 40 }),
    swingX: axisParams({ minAngle: -20, maxAngle: 20, speed: 2 }),
    yawY: axisParams({ minAngle: -15, maxAngle: 15, speed: 3 }),
  },
  axes: [
    { key: "0", custom: true, mount: { x: 100, z: 100 } },
    { key: "1", custom: true, mount: { x: -100, z: 100 } },
    { key: "2", custom: true, mount: { x: -100, z: -100 } },
    { key: "3", custom: true, mount: { x: 100, z: -100 } },
  ],
};

const hoistObject: ControlledObject = {
  ...baseObject,
  controlType: "singlePointMove",
  motionParams: { move: axisParams() },
  axes: [{ key: "0", custom: false, mount: { x: 0, z: 0 } }],
};

const twoPointSwingObject: ControlledObject = {
  ...baseObject,
  controlType: "twoPointSwing",
  pMaxVelocity: 4,
  yMaxVelocity: 5,
  motionParams: {
    move: axisParams(),
    swingX: axisParams({ minAngle: -20, maxAngle: 20, speed: 2 }),
  },
  axes: [
    { key: "0", custom: true, mount: { x: 100, z: 0 } },
    { key: "1", custom: true, mount: { x: -100, z: 0 } },
  ],
};

describe("buildModelParamPayload max velocity", () => {
  it("includes p/y max velocity and never hMaxVelocity", () => {
    const payload = buildModelParamPayload(multiPointObject, []);
    expect(payload?.paramCount.pMaxVelocity).toBe(4);
    expect(payload?.paramCount.yMaxVelocity).toBe(5);
    expect(payload?.paramCount).not.toHaveProperty("hMaxVelocity");
  });

  it("omits p/y max velocity for hoist-only objects", () => {
    const payload = buildModelParamPayload(hoistObject, []);
    expect(payload?.paramCount).not.toHaveProperty("pMaxVelocity");
    expect(payload?.paramCount).not.toHaveProperty("yMaxVelocity");
  });

  it("includes only pMaxVelocity for two-point swing", () => {
    const payload = buildModelParamPayload(twoPointSwingObject, []);
    expect(payload?.paramCount.pMaxVelocity).toBe(4);
    expect(payload?.paramCount).not.toHaveProperty("yMaxVelocity");
    expect(payload?.paramCount).not.toHaveProperty("hMaxVelocity");
  });
});
