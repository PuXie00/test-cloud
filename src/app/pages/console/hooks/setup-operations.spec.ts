import { describe, expect, it } from "vitest";
import { MOTION_DEFAULTS } from "@/app/project/configuration-rules";
import { persistSetupFromWizard, type WizardSetupState } from "@/app/project/setup-persist";
import { createEmptyDocument } from "@/app/project/project-document-empty";
import type { ControlledObject } from "../components/right-sidebar/config-wizard/config-wizard-types";
import { distributeMounts } from "../components/right-sidebar/config-wizard/multi-point-axes/multi-point-axes-distribute";
import { applyMultiPointAxesConfiguration, changeObjectControlType } from "./setup-operations";
import { analyzeControlTypeChangeImpact, applyControlTypeChange } from "./control-type-change";

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
    const next = changed(objectOf({ motionParams: { h } }), "dualTiltFourPointSwing");
    expect(next.motionParams).toEqual({ h, p: MOTION_DEFAULTS.swingX, y: MOTION_DEFAULTS.swingY });
  });

  it("keeps p and y across swing types, including swingY to yawY", () => {
    const motionParams = {
      h: { ...MOTION_DEFAULTS.move, maxAngle: 8000 },
      p: { ...MOTION_DEFAULTS.swingX, maxAngle: 12, defaultMaxVelocity: 4 },
      y: { ...MOTION_DEFAULTS.swingY, maxAngle: 9, defaultMaxVelocity: 5 },
    };
    const next = changed(
      objectOf({
        controlType: "dualTiltFourPointSwing",
        motionParams,
        motionSpeedControl: { speedRatio: 1, overrides: { y: { enabled: true, speed: 1 } } },
      }),
      "multiPointSwing",
    );
    // 多点摆虚轴3 是无极轴，沿用的范围收成 0~360
    expect(next.motionParams).toEqual({
      ...motionParams,
      y: { ...motionParams.y, minAngle: 0, maxAngle: 360 },
    });
    expect(next.motionSpeedControl?.overrides).toEqual({ y: { enabled: true, speed: 1 } });
  });

  it("drops axes the new control type does not have", () => {
    const next = changed(
      objectOf({
        controlType: "dualTiltFourPointSwing",
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

describe("changeObjectControlType per-type params", () => {
  it("clamps kept strokes into the new type's range", () => {
    const next = changed(
      objectOf({
        controlType: "multiLevelHoist",
        motionParams: { h: { ...MOTION_DEFAULTS.move, minAngle: -800, maxAngle: 3000 } },
      }),
      "singlePointMove",
    );
    expect(next.motionParams?.h).toMatchObject({ minAngle: 0, maxAngle: 3000 });
  });

  it("adds the multi-level config when becoming a multi-level hoist and drops it after", () => {
    const hoist = changed(objectOf({}), "multiLevelHoist");
    expect(hoist.multiLevel).toEqual({ adjustDistances: [], decelerationRatio: 50 });
    const withPoints = { ...hoist, multiLevel: { adjustDistances: [200], decelerationRatio: 30 } };
    expect(changed(withPoints, "singlePointMove")).not.toHaveProperty("multiLevel");
    expect(changed(withPoints, "staticProp")).not.toHaveProperty("multiLevel");
  });
});

describe("multi-point swing params", () => {
  it("switches a four-hoist swing to XY without removing hoists or unbinding motors", () => {
    const object = objectOf({
      controlType: "multiPointSwing",
      mountLayout: { kind: "line", spacings: [200, 200, 200] },
      axes: [-300, -100, 100, 300].map((x, i) => ({
        key: String(i), custom: false, mount: { x, z: 0 },
      })),
    });
    const state = stateOf(object);
    state.motors = object.axes.map((axis, i) => ({
      id: 20 + i, plcId: 10, productModel: "hoist", busNo: 0, axisType: 0,
      nodeAddress: null, selected: true, controlledObjectId: object.id, axisKey: axis.key, params: {},
    }));
    const document = createEmptyDocument({ id: "swing", name: "swing", author: "" });
    document.setup = persistSetupFromWizard(state);
    const impact = analyzeControlTypeChangeImpact(document, [object.id], "dualTiltFourPointSwing");
    expect(impact).toMatchObject({ changed: false, removedDriveAxes: 0, unboundMotors: 0 });
    const next = applyControlTypeChange(document, [object.id], "dualTiltFourPointSwing");
    expect(next.setup.controlledObjects[0]).toMatchObject({
      driveAxes: document.setup.controlledObjects[0]!.driveAxes, mountLayout: object.mountLayout,
    });
    expect(next.setup.motors).toEqual(document.setup.motors);
  });

  it("keeps nonconsecutive XY hoist keys and adds only enough for a four-hoist swing", () => {
    const axes = [
      { key: "4", custom: true, mount: { x: -300, z: 0 } },
      { key: "1", custom: false, mount: { x: 300, z: 0 } },
    ];
    const object = objectOf({ controlType: "dualTiltFourPointSwing", axes });
    const next = changed(object, "multiPointSwing");
    expect(next.axes.slice(0, 2)).toEqual(axes);
    expect(next.axes.map(axis => axis.key)).toEqual(["4", "1", "0", "2"]);
  });

  const dualTilt = () =>
    changed(objectOf({ shapeDimensions: { width: 3000, height: 1000, depth: 3000 }, dimensions: { w: 3000, h: 1000, d: 3000 } }), "dualTiltFourPointSwing");

  const apply = (object: ControlledObject, mounts: Array<{ x: number; z: number }>) =>
    applyMultiPointAxesConfiguration(stateOf(object), object.id, {
      axes: mounts.map((mount, index) => ({ key: String(index), custom: false, mount })),
      safetyRadius: 1200,
      initialTiltDirection: 30,
      mountLayout: { kind: "custom" },
      unbindAxisKeys: [],
      bindAxisMotors: [],
    });

  it("has no mount rotation and keeps the initial tilt of a dual tilt at 0", () => {
    const object = dualTilt();
    expect(object).not.toHaveProperty("mountRotation");
    expect(object.initialTiltDirection).toBe(0);
    expect(changed({ ...object, initialTiltDirection: 45 }, "dualTiltFourPointSwing").initialTiltDirection).toBe(0);
  });

  it("saves the safety radius of a dual tilt but not its initial tilt", () => {
    const result = apply(dualTilt(), [
      { x: -500, z: 0 },
      { x: 500, z: 0 },
    ]);
    expect(result.applied).toBe(true);
    expect(result.state.objects[0]).toMatchObject({ safetyRadius: 1200, initialTiltDirection: 0 });
    expect(result.state.objects[0]).not.toHaveProperty("mountRotation");
  });

  it("needs two dual tilt hoists on one axis with the origin between them", () => {
    for (const mounts of [
      [{ x: 0, z: -300 }, { x: 0, z: 600 }],
      [{ x: 0, z: 0 }, { x: 800, z: 0 }],
    ]) {
      expect(apply(dualTilt(), mounts).applied).toBe(true);
    }
    for (const mounts of [
      [{ x: -500, z: 100 }, { x: 500, z: 100 }],
      [{ x: 200, z: 0 }, { x: 500, z: 0 }],
      [{ x: -500, z: -500 }, { x: 500, z: 500 }],
      [{ x: 0.01, z: -675 }, { x: 0.01, z: 675 }],
      [{ x: 0, z: 0 }, { x: 0, z: 0 }],
    ]) {
      const result = apply(dualTilt(), mounts);
      expect(result.applied).toBe(false);
      expect(result.reason).toContain("同一 X 或 Y 轴");
    }
  });

  it("accepts the opposite edge midpoints produced by perimeter distribution", () => {
    const mounts = distributeMounts(
      { kind: "rectangle", halfWidth: 1000, halfDepth: 750 }, "rect-perimeter", 2,
    );
    expect(mounts.map(({ z }) => z)).toEqual([-675, 675]);
    expect(apply(dualTilt(), mounts).applied).toBe(true);
  });
});
