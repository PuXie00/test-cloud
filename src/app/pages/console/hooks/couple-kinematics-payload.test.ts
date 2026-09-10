import { describe, expect, it } from "vitest";
import type {
  ControlledObject,
  Motor,
} from "../components/right-sidebar/config-wizard/config-wizard-types";
import type { MotionAxisParams } from "@/app/project/configuration-types";
import {
  assignSolverIndexes,
  buildSolverCallItem,
} from "./couple-kinematics-payload";

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

const motor = (id: number, objectId: number, axisKey: string): Motor => ({
  id,
  productModel: "YZ_AXIS_HOIST_500KG",
  plcId: 10,
  busNo: 0,
  axisType: 0,
  nodeAddress: String(id),
  selected: false,
  controlledObjectId: objectId,
  axisKey,
  params: {},
});

const twoPoint: ControlledObject = {
  id: 42,
  name: "Two",
  controlType: "twoPointSwing",
  shapePreset: "cube",
  shapeDimensions: { width: 2000, height: 1000, depth: 400 },
  dimensions: { w: 2000, h: 1000, d: 400 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  motionParams: {
    move: axisParams({ minAngle: 10, maxAngle: 800 }),
    swingX: axisParams({ minAngle: -30, maxAngle: 30 }),
  },
  maxAxisVelocity: 200,
  pulleyDistance: 120,
  modelRunDirection: 1,
  axes: [
    { key: "0", custom: false, mount: { x: -500, z: 0 } },
    { key: "1", custom: false, mount: { x: 500, z: 0 } },
  ],
};

const fourPoint: ControlledObject = {
  ...twoPoint,
  id: 43,
  name: "Four",
  controlType: "fourPointSwing",
  dimensions: { w: 1800, h: 1000, d: 900 },
  motionParams: {
    move: axisParams({ minAngle: 0, maxAngle: 800 }),
    swingX: axisParams({ minAngle: -20, maxAngle: 20 }),
    swingY: axisParams({ minAngle: -15, maxAngle: 15 }),
  },
  axes: [
    { key: "0", custom: false, mount: { x: -400, z: -200 } },
    { key: "1", custom: false, mount: { x: 400, z: -200 } },
    { key: "2", custom: false, mount: { x: 400, z: 200 } },
    { key: "3", custom: false, mount: { x: -400, z: 200 } },
  ],
};

const multiPoint: ControlledObject = {
  ...twoPoint,
  id: 44,
  name: "Multi",
  controlType: "multiPointSwing",
  safetyRadius: 1500,
  initialTiltDirection: 90,
  pulleyDistance: 80,
  modelRunDirection: 2,
  motionParams: {
    move: axisParams({ minAngle: 10, maxAngle: 800 }),
    swingX: axisParams({ minAngle: -20, maxAngle: 20 }),
    yawY: axisParams({ minAngle: -15, maxAngle: 15 }),
  },
  axes: [
    { key: "0", custom: true, mount: { x: 100, z: 100 } },
    { key: "1", custom: true, mount: { x: -100, z: 100 } },
    { key: "2", custom: true, mount: { x: -100, z: -100 } },
  ],
};

describe("assignSolverIndexes", () => {
  it("uses 1-based array slots, not object ids", () => {
    const indexed = assignSolverIndexes([
      { objectId: 42, payload: { type: 32 } },
      { objectId: 99, payload: { type: 63 } },
    ]);
    expect(indexed.map((item) => item.index)).toEqual([1, 2]);
    expect(indexed.map((item) => item.objectId)).toEqual([42, 99]);
  });
});

describe("buildSolverCallItem", () => {
  it("builds a two-point request with span, rim, and motor lengths in axis order", () => {
    const item = buildSolverCallItem({
      object: twoPoint,
      motors: [motor(7, 42, "1"), motor(6, 42, "0")],
      motorPositions: new Map([
        [6, 110],
        [7, 130],
      ]),
      hpy: [200, 5, 0],
      index: 1,
    });
    expect(item.index).toBe(1);
    expect(item.type).toBe(32);
    expect(item.origin_distance1).toBe(120);
    expect(item.origin_distance2).toBe(0);
    expect(item.params).toEqual([[1000]]);
    expect(item.motor_H).toEqual([110, 130]);
    expect(item.limit_data[0]).toEqual([10, 800]);
    expect(item.limit_rim).toEqual([2000]);
    expect(item.HPY).toEqual([200, 5, 0]);
    expect(item.betainit).toBe(0);
  });

  it("builds a four-point request with bbox spans and two rim values", () => {
    const item = buildSolverCallItem({
      object: fourPoint,
      motors: [
        motor(1, 43, "0"),
        motor(2, 43, "1"),
        motor(3, 43, "2"),
        motor(4, 43, "3"),
      ],
      motorPositions: new Map([
        [1, 10],
        [2, 20],
        [3, 30],
        [4, 40],
      ]),
      hpy: [100, 1, 2],
      index: 1,
    });
    expect(item.type).toBe(64);
    expect(item.params).toEqual([[800, 400]]);
    expect(item.limit_rim).toEqual([1800, 900]);
    expect(item.motor_H).toEqual([10, 20, 30, 40]);
  });

  it("builds a multi-point request with hoist xyz, safety radius, and reversed origin distances", () => {
    const item = buildSolverCallItem({
      object: multiPoint,
      motors: [motor(1, 44, "0"), motor(2, 44, "1"), motor(3, 44, "2")],
      motorPositions: new Map([
        [1, 50],
        [2, 60],
        [3, 70],
      ]),
      hpy: [300, 0, 1],
      index: 2,
    });
    expect(item.index).toBe(2);
    expect(item.type).toBe(63);
    expect(item.origin_distance1).toBe(0);
    expect(item.origin_distance2).toBe(80);
    expect(item.params).toEqual([
      [100, 100, 0],
      [-100, 100, 0],
      [-100, -100, 0],
    ]);
    expect(item.limit_rim).toEqual([1500]);
    expect(item.betainit).toBe(90);
  });
});
