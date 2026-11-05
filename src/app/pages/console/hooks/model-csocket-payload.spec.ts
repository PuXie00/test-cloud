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
  motionParams: { h: axisParams() },
  maxAxisVelocity: 200,
  pulleyDistance: 0,
  modelRunDirection: 1,
  axes: [{ key: "0", custom: false, mount: { x: 0, z: 0 } }],
  params: {},
};

const multiPointObject: ControlledObject = {
  ...baseObject,
  controlType: "multiPointSwing",
  safetyRadius: 1500,
  initialTiltDirection: 90,
  motionParams: {
    h: axisParams({ maxAngle: 800, minAngle: 10, speed: 40 }),
    p: axisParams({ minAngle: -20, maxAngle: 20, speed: 2, defaultMaxVelocity: 4 }),
    y: axisParams({ minAngle: -15, maxAngle: 15, speed: 3, defaultMaxVelocity: 5 }),
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
  motionParams: { h: axisParams() },
  axes: [{ key: "0", custom: false, mount: { x: 0, z: 0 } }],
};

describe("buildModelParamPayload max velocity", () => {
  it("includes p/y max velocity and never hMaxVelocity", () => {
    const payload = buildModelParamPayload(multiPointObject, []);
    expect(payload?.paramCount.pDefaultMaxVelocity).toBe(4);
    expect(payload?.paramCount.yDefaultMaxVelocity).toBe(5);
    expect(payload?.paramCount).not.toHaveProperty("hMaxVelocity");
  });

  it("omits p/y max velocity for hoist-only objects", () => {
    const payload = buildModelParamPayload(hoistObject, []);
    expect(payload?.paramCount).not.toHaveProperty("pDefaultMaxVelocity");
    expect(payload?.paramCount).not.toHaveProperty("yDefaultMaxVelocity");
  });
});

describe("buildModelParamPayload max acceleration", () => {
  const motor = (maxAxisVelocity: number) =>
    ({ controlledObjectId: 42, params: { maxAxisVelocity } }) as unknown as Parameters<
      typeof buildModelParamPayload
    >[1][number];

  it("derives h/p/y max accel/decel from each virtual axis max velocity / minAccelTime", () => {
    const object: ControlledObject = {
      ...multiPointObject,
      motionParams: {
        h: axisParams({ speed: 40, minAccelTime: 0.5 }),
        p: axisParams({ speed: 2, minAccelTime: 2, defaultMaxVelocity: 4 }),
        y: axisParams({ speed: 3, minAccelTime: 0.5, defaultMaxVelocity: 5 }),
      },
    };
    const payload = buildModelParamPayload(object, [motor(300), motor(250)]);
    expect(payload?.paramCount.hMaxAcceleration).toBe(500);
    expect(payload?.paramCount.hMaxDeceleration).toBe(500);
    expect(payload?.paramCount.pMaxAcceleration).toBe(2);
    expect(payload?.paramCount.pMaxDeceleration).toBe(2);
    expect(payload?.paramCount.yMaxAcceleration).toBe(10);
    expect(payload?.paramCount.yMaxDeceleration).toBe(10);
  });

  it("uses the unbound v1 max velocity when no motor is bound", () => {
    const payload = buildModelParamPayload(hoistObject, []);
    expect(payload?.paramCount.hMaxAcceleration).toBe(500);
    expect(payload?.paramCount.hMaxDeceleration).toBe(500);
  });
});

describe("buildModelParamPayload multi-level hoist", () => {
  const multiLevelObject: ControlledObject = {
    ...hoistObject,
    controlType: "multiLevelHoist",
    motionParams: { h: axisParams({ minAngle: 0, maxAngle: 1000 }) },
    multiLevel: { adjustDistances: [100, 400, 1200], decelerationRatio: 60 },
  };

  it("sends section count, positions inside the stroke and the speed ratio", () => {
    const payload = buildModelParamPayload(multiLevelObject, []);
    expect(payload?.paramCount).toMatchObject({
      modelType: 3,
      nSections: 2,
      adjustDistanceList: [{ adjustDistance: 100 }, { adjustDistance: 400 }],
      decelerationRatio: 60,
    });
  });

  it("does not send them for other types", () => {
    const payload = buildModelParamPayload(hoistObject, []);
    expect(payload?.paramCount).not.toHaveProperty("nSections");
    expect(payload?.paramCount).not.toHaveProperty("adjustDistanceList");
    expect(payload?.paramCount).not.toHaveProperty("decelerationRatio");
  });
});
