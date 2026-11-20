import { describe, expect, it } from "vitest";
import { encodeControlType } from "@/app/project/control-type-code";
import type { ControlledObjectConfig, MotorConfig } from "@/app/project/project-document-types";
import { buildMotorOverspeedObjects } from "./motor-overspeed-from-setup";

const object = {
  id: 44,
  name: "Multi",
  controlType: encodeControlType("multiPointSwing"),
  enabledVirtualAxes: ["v1", "v2", "v3"] as const,
  pulleyDistance: 80,
  modelRunDirection: 2,
  initialTiltDirection: 90,
  motionParams: { h: { maxAngle: 800 } },
  maxAxisVelocity: 500,
  driveAxes: [
    { key: "0", mount: { x: 100, z: 100 } },
    { key: "1", mount: { x: -100, z: 100 } },
  ],
} as unknown as ControlledObjectConfig;

const motor = (id: number, axisKey: string, velocity: number): MotorConfig =>
  ({
    id,
    productModel: `M${id}`,
    plcId: 1,
    busNo: 0,
    axisType: 0,
    nodeAddress: String(id),
    controlledObjectId: 44,
    axisKey,
    params: { maxAxisVelocity: velocity },
  }) as MotorConfig;

describe("buildMotorOverspeedObjects", () => {
  it("maps multi-point objects to hoist geometry in axis order", () => {
    const [hoist] = buildMotorOverspeedObjects([object], [motor(1, "0", 200), motor(2, "1", 180)]);
    expect(hoist?.objectId).toBe(44);
    expect(hoist?.baseHeight1).toBe(0);
    expect(hoist?.baseHeight2).toBe(80);
    expect(hoist?.betaInit).toBe(90);
    expect(hoist?.xyTilt).toBeUndefined();
    expect(hoist?.pointInitPos).toEqual([
      [100, 100, 0],
      [-100, 100, 0],
    ]);
    expect(hoist?.motors.map((item) => item.id)).toEqual([1, 2]);
    expect(hoist?.motors.map((item) => item.ropeIndex)).toEqual([0, 1]);
  });

  it("keeps each motor on its drive axis rope when an earlier axis has no motor", () => {
    const [hoist] = buildMotorOverspeedObjects([object], [motor(2, "1", 180)]);
    expect(hoist?.pointInitPos).toHaveLength(2);
    expect(hoist?.motors).toEqual([
      { id: 2, name: "M2", maxAxisVelocity: 180, ropeIndex: 1 },
    ]);
  });

  it("limits every motor to the slowest bound motor like the PLC", () => {
    const [hoist] = buildMotorOverspeedObjects([object], [motor(1, "0", 200), motor(2, "1", 180)]);
    expect(hoist?.motors.map((item) => item.maxAxisVelocity)).toEqual([180, 180]);
  });

  it("maps dual tilt objects as XY tilt without initial tilt direction", () => {
    const [hoist] = buildMotorOverspeedObjects(
      [{ ...object, controlType: encodeControlType("dualTiltFourPointSwing") }],
      [motor(1, "0", 200)],
    );
    expect(hoist?.xyTilt).toBe(true);
    expect(hoist?.betaInit).toBe(0);
  });

  it("ignores objects that are not multi-point swing or dual tilt", () => {
    const hoist = buildMotorOverspeedObjects(
      [{ ...object, controlType: encodeControlType("singlePointMove") }],
      [motor(1, "0", 200)],
    );
    expect(hoist).toEqual([]);
  });
});
