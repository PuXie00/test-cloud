import { describe, expect, it } from "vitest";
import type { ControlType } from "@/app/project/configuration-types";
import { encodeSolverType } from "./couple-kinematics-type";

describe("encodeSolverType", () => {
  it("maps swing and single-point move to Python type codes", () => {
    expect(encodeSolverType("twoPointSwing")).toBe(32);
    expect(encodeSolverType("fourPointSwing")).toBe(64);
    expect(encodeSolverType("dualTiltFourPointSwing")).toBe(64);
    expect(encodeSolverType("multiPointSwing")).toBe(63);
    expect(encodeSolverType("singlePointMove")).toBe(31);
  });

  it("does not send rotation, rail, static, or multi-level hoist to the exe", () => {
    const skipped: ControlType[] = [
      "singlePointRotation",
      "continuousRotation",
      "railCar",
      "staticProp",
      "multiLevelHoist",
    ];
    for (const controlType of skipped) {
      expect(encodeSolverType(controlType)).toBeNull();
    }
  });
});
