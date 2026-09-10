import { describe, expect, it } from "vitest";
import { MOTION_DEFAULTS } from "./configuration-rules";
import { setupObjectToTimelineObject } from "./motion-adapters";
import { sequenceValidationContextFromSetup } from "./project-motion-readiness";
import type { ControlledObjectConfig, MotorConfig, ProjectDocument } from "./project-document-types";
import { createEmptyDocument } from "./project-document-empty";

const swingObject = (): ControlledObjectConfig => ({
  id: 8,
  name: "swing",
  controlType: 6,
  enabledVirtualAxes: ["v1", "v2"],
  shapePreset: "cube",
  shapeDimensions: { width: 1, height: 1, depth: 1 },
  dimensions: { w: 1, h: 1, d: 1 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  pulleyDistance: 0,
  modelRunDirection: 1,
  safetyRadius: 1000,
  driveAxes: [
    { key: "0", mount: { x: 0, z: 0 } },
    { key: "1", mount: { x: 0, z: 0 } },
  ],
  maxAxisVelocity: 200,
  pMaxVelocity: 4,
  motionParams: {
    move: { ...MOTION_DEFAULTS.move },
    swingX: { ...MOTION_DEFAULTS.swingX },
  },
  params: {},
});

const boundMotors = (): MotorConfig[] => [
  {
    id: 1,
    productModel: "YZ_AXIS_HOIST_500KG",
    plcId: 1,
    busNo: 0,
    axisType: 0,
    nodeAddress: null,
    controlledObjectId: 8,
    axisKey: "0",
    params: { maxAxisVelocity: 400 },
  },
  {
    id: 2,
    productModel: "YZ_AXIS_HOIST_500KG",
    plcId: 1,
    busNo: 0,
    axisType: 0,
    nodeAddress: null,
    controlledObjectId: 8,
    axisKey: "1",
    params: { maxAxisVelocity: 180 },
  },
];

describe("sequenceValidationContextFromSetup", () => {
  it("uses bound motor min for v1 and object fields for v2/v3", () => {
    const document = createEmptyDocument({ id: "p", name: "P", author: "t" });
    document.setup.controlledObjects = [swingObject()];
    document.setup.motors = boundMotors();
    document.setup.plcs = [{ id: 1, masterTypeId: "AC810_1", ip: "127.0.0.1" }];
    const ctx = sequenceValidationContextFromSetup(document as ProjectDocument);
    expect(ctx.objects[0]?.limits.v1?.maxVelocity).toBe(180);
    expect(ctx.objects[0]?.limits.v2?.maxVelocity).toBe(4);
    expect(ctx.objects[0]?.limits.v1?.minAccelTime).toBe(MOTION_DEFAULTS.move.minAccelTime);
    expect(ctx.objects[0]?.limits.v1).not.toHaveProperty("maxAcceleration");
    expect(ctx.objects[0]?.limits.v1).not.toHaveProperty("maxDeceleration");
    expect(ctx.objects[0]?.limits.v2).not.toHaveProperty("maxAcceleration");
    expect(ctx.objects[0]?.limits.v2).not.toHaveProperty("maxDeceleration");

    const timeline = setupObjectToTimelineObject(swingObject(), boundMotors());
    expect(timeline.rangeByAxis?.v1).toEqual({
      min: MOTION_DEFAULTS.move.minAngle,
      max: MOTION_DEFAULTS.move.maxAngle,
    });
    expect(timeline.rangeByAxis?.v2).toEqual({
      min: MOTION_DEFAULTS.swingX.minAngle,
      max: MOTION_DEFAULTS.swingX.maxAngle,
    });
    expect(timeline.maxSpeedByAxis?.v1).toBe(180);
    expect(timeline.maxAccelerationByAxis).toBeUndefined();
    expect(timeline.maxDecelerationByAxis).toBeUndefined();
  });
});
