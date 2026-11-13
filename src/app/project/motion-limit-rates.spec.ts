import { describe, expect, it } from "vitest";
import type {
  ControlledObject,
  Motor,
} from "@/app/pages/console/components/right-sidebar/config-wizard/config-wizard-types";
import { MOTION_DEFAULTS } from "./configuration-rules";
import type { MotionAxisParams } from "./configuration-types";
import {
  deriveMotionAxisLimitRates,
  normalizeMotionAxisParams,
} from "./motion-acceleration";
import { wizardControlledObjectToConfig } from "./setup-persist";
import {
  DEFAULT_SWING_AXIS_MAX_VELOCITY,
  UNBOUND_V1_MAX_VELOCITY,
} from "./virtual-axis-max-velocity";

const axis = (overrides: Partial<MotionAxisParams> = {}): MotionAxisParams => ({
  ...MOTION_DEFAULTS.move,
  ...overrides,
});

const motor = (id: number, controlledObjectId: number | null, maxAxisVelocity: number): Motor => ({
  id,
  productModel: "M",
  plcId: 1,
  busNo: 0,
  axisType: 0,
  nodeAddress: null,
  selected: false,
  controlledObjectId,
  axisKey: controlledObjectId === null ? null : String(id),
  params: { maxAxisVelocity },
});

const swingObject = (motionParams: ControlledObject["motionParams"]): ControlledObject => ({
  id: 5,
  name: "多点",
  controlType: "multiPointSwing",
  shapePreset: "cube",
  shapeDimensions: { width: 1000, height: 1000, depth: 1000 },
  dimensions: { w: 1000, h: 1000, d: 1000 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  motionParams,
  maxAxisVelocity: 200,
  pulleyDistance: 0,
  modelRunDirection: 1,
  safetyRadius: 1500,
  initialTiltDirection: 0,
  axes: [0, 1, 2, 3].map((index) => ({
    key: String(index),
    custom: true,
    mount: { x: index * 100, z: 0 },
  })),
  params: {},
});

describe("deriveMotionAxisLimitRates", () => {
  it("max accel/decel = max velocity / minAccelTime, abnormal = max velocity / emergencyDecelTime", () => {
    expect(deriveMotionAxisLimitRates(300, { minAccelTime: 1.5, emergencyDecelTime: 0.2 })).toEqual({
      maxAcceleration: 200,
      maxDeceleration: 200,
      abnormalDeceleration: 1500,
    });
  });

  it("is 0 for a non-positive time", () => {
    expect(deriveMotionAxisLimitRates(300, { minAccelTime: 0, emergencyDecelTime: -1 })).toEqual({
      maxAcceleration: 0,
      maxDeceleration: 0,
      abnormalDeceleration: 0,
    });
  });
});

describe("normalizeMotionAxisParams", () => {
  it("derives acceleration from speed but never the max/abnormal rates", () => {
    const stored = axis({
      speed: 80,
      accelTime: 4,
      maxAcceleration: 11,
      maxDeceleration: 11,
      abnormalDeceleration: 22,
    });
    expect(normalizeMotionAxisParams(stored)).toMatchObject({
      acceleration: 20,
      deceleration: 20,
      maxAcceleration: 11,
      maxDeceleration: 11,
      abnormalDeceleration: 22,
    });
  });

  it("derives the max/abnormal rates from the given max velocity, whatever the speed", () => {
    const at = (speed: number) =>
      normalizeMotionAxisParams(axis({ speed, minAccelTime: 2, emergencyDecelTime: 0.5 }), 240);
    for (const params of [at(10), at(200)]) {
      expect(params).toMatchObject({
        maxAcceleration: 120,
        maxDeceleration: 120,
        abnormalDeceleration: 480,
      });
    }
  });

  it("gives new objects the unbound virtual axis max velocity rates", () => {
    expect(MOTION_DEFAULTS.move).toMatchObject({
      maxAcceleration: UNBOUND_V1_MAX_VELOCITY / MOTION_DEFAULTS.move.minAccelTime,
      abnormalDeceleration: UNBOUND_V1_MAX_VELOCITY / MOTION_DEFAULTS.move.emergencyDecelTime,
    });
    expect(MOTION_DEFAULTS.swingX).toMatchObject({
      maxAcceleration: DEFAULT_SWING_AXIS_MAX_VELOCITY / MOTION_DEFAULTS.swingX.minAccelTime,
      abnormalDeceleration:
        DEFAULT_SWING_AXIS_MAX_VELOCITY / MOTION_DEFAULTS.swingX.emergencyDecelTime,
    });
  });
});

describe("saving motion params to the project file", () => {
  const object = swingObject({
    h: axis({ speed: 40, minAccelTime: 0.5, emergencyDecelTime: 0.1, abnormalDeceleration: 400 }),
    p: { ...MOTION_DEFAULTS.swingX, speed: 1, minAccelTime: 2, emergencyDecelTime: 0.2, defaultMaxVelocity: 4 },
    y: { ...MOTION_DEFAULTS.yawY, speed: 2, minAccelTime: 0.5, emergencyDecelTime: 0.5, defaultMaxVelocity: 5 },
  });

  it("takes the v1 max velocity as the smallest bound motor axis max velocity", () => {
    const motors = [motor(1, 5, 300), motor(2, 5, 250), motor(3, 9, 50), motor(4, null, 10)];
    const { motionParams } = wizardControlledObjectToConfig(object, motors);
    expect(motionParams.h).toMatchObject({
      maxAcceleration: 500,
      maxDeceleration: 500,
      abnormalDeceleration: 2500,
    });
    expect(motionParams.p).toMatchObject({
      maxAcceleration: 2,
      maxDeceleration: 2,
      abnormalDeceleration: 20,
    });
    expect(motionParams.y).toMatchObject({
      maxAcceleration: 10,
      maxDeceleration: 10,
      abnormalDeceleration: 10,
    });
  });

  it("uses the unbound v1 max velocity when no motor is bound", () => {
    const { motionParams } = wizardControlledObjectToConfig(object, []);
    expect(motionParams.h).toMatchObject({
      maxAcceleration: UNBOUND_V1_MAX_VELOCITY / 0.5,
      abnormalDeceleration: UNBOUND_V1_MAX_VELOCITY / 0.1,
    });
  });
});
