import { describe, expect, it } from "vitest";
import type { ControlType } from "@/app/project/configuration-types";
import { encodeSolverType } from "./couple-kinematics-type";

describe("encodeSolverType", () => {
  it("maps models to solver type codes", () => {
    expect(encodeSolverType("singlePointMove")).toBe(2);
    expect(encodeSolverType("multiLevelHoist")).toBe(3);
    expect(encodeSolverType("multiPointSwing")).toBe(7);
    expect(encodeSolverType("dualTiltFourPointSwing")).toBe(9);
  });

  it("does not send rotation, rail, or static props to the exe", () => {
    const skipped: ControlType[] = [
      "singlePointRotation",
      "continuousRotation",
      "railCar",
      "staticProp",
    ];
    for (const controlType of skipped) {
      expect(encodeSolverType(controlType)).toBeNull();
    }
  });
});
