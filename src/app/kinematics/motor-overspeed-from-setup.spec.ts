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
  motionParams: { move: { maxAngle: 800 } },
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
    const [hoist] = buildMotorOverspeedObjects( [object], [motor(1, "0", 200), motor(2, "1", 180)]);
    expect(hoist?.objectId).toBe(44);
    expect(hoist?.baseHeight1).toBe(0);
    expect(hoist?.baseHeight2).toBe(80);
    expect(hoist?.betaInit).toBe(90);
    expect(hoist?.pointInitPos).toEqual([
      [100, 100, 0],
      [-100, 100, 0],
    ]);
    expect(hoist?.motors.map((item) => item.maxAxisVelocity)).toEqual([200, 180]);
  });

  it("ignores objects that are not multi-point swing", () => {
    const hoist = buildMotorOverspeedObjects(
      [{ ...object, controlType: encodeControlType("twoPointSwing") }],
      [motor(1, "0", 200)],
    );
    expect(hoist).toEqual([]);
  });
});
