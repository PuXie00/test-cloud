import { describe, expect, it } from "vitest";
import { MOTION_DEFAULTS } from "@/app/project/configuration-rules";
import type { WizardSetupState } from "@/app/project/setup-persist";
import type { ControlledObject } from "../components/right-sidebar/config-wizard/config-wizard-types";
import { changeObjectControlType } from "./setup-operations";

const objectOf = (overrides: Partial<ControlledObject>): ControlledObject => ({
  id: 1,
  name: "O",
  controlType: "singlePointMove",
  shapePreset: "cube",
  shapeDimensions: { width: 1000, height: 1000, depth: 1000 },
  dimensions: { w: 1000, h: 1000, d: 1000 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  motionParams: { h: { ...MOTION_DEFAULTS.move } },
  maxAxisVelocity: 200,
  pulleyDistance: 0,
  modelRunDirection: 1,
  axes: [{ key: "0", custom: false, mount: { x: 0, z: 0 } }],
  params: {},
  ...overrides,
});

const stateOf = (object: ControlledObject): WizardSetupState => ({
  plcs: [],
  motors: [],
  objects: [object],
});

const changed = (object: ControlledObject, controlType: ControlledObject["controlType"]) =>
  changeObjectControlType(stateOf(object), object.id, controlType).objects[0]!;

describe("changeObjectControlType motionParams", () => {
  it("resets h to defaults when its kind changes between move and rotation", () => {
    const next = changed(
      objectOf({
        motionParams: { h: { ...MOTION_DEFAULTS.move, maxAngle: 8000, speed: 120 } },
        motionSpeedControl: { speedRatio: 1, overrides: { h: { enabled: true, speed: 120 } } },
      }),
      "singlePointRotation",
    );
    expect(next.motionParams).toEqual({ h: MOTION_DEFAULTS.rotation });
    expect(next.motionSpeedControl).toEqual({ speedRatio: 1, overrides: {} });
  });

  it("keeps h when the kind stays move, and adds defaults for new axes", () => {
    const h = { ...MOTION_DEFAULTS.move, maxAngle: 8000 };
    const next = changed(objectOf({ motionParams: { h } }), "twoPointSwing");
    expect(next.motionParams).toEqual({ h, p: MOTION_DEFAULTS.swingX });
  });

  it("keeps p and y across swing types, including swingY to yawY", () => {
    const motionParams = {
      h: { ...MOTION_DEFAULTS.move, maxAngle: 8000 },
      p: { ...MOTION_DEFAULTS.swingX, maxAngle: 12, defaultMaxVelocity: 4 },
      y: { ...MOTION_DEFAULTS.swingY, maxAngle: 9, defaultMaxVelocity: 5 },
    };
    const next = changed(
      objectOf({
        controlType: "fourPointSwing",
        motionParams,
        motionSpeedControl: { speedRatio: 1, overrides: { y: { enabled: true, speed: 1 } } },
      }),
      "multiPointSwing",
    );
    expect(next.motionParams).toEqual(motionParams);
    expect(next.motionSpeedControl?.overrides).toEqual({ y: { enabled: true, speed: 1 } });
  });

  it("drops axes the new control type does not have", () => {
    const next = changed(
      objectOf({
        controlType: "twoPointSwing",
        motionParams: {
          h: { ...MOTION_DEFAULTS.move },
          p: { ...MOTION_DEFAULTS.swingX },
        },
        motionSpeedControl: { speedRatio: 1, overrides: { p: { enabled: true, speed: 2 } } },
      }),
      "singlePointMove",
    );
    expect(Object.keys(next.motionParams ?? {})).toEqual(["h"]);
    expect(next.motionSpeedControl?.overrides).toEqual({});
  });
});
