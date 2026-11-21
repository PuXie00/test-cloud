// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOTION_DEFAULTS } from "@/app/project/configuration-rules";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import type { ControlledObject } from "../config-wizard-types";
import { MultiPointAxesDialog } from "./multi-point-axes-dialog";

vi.mock("@/app/pages/console/3d/Viz3DProvider", () => ({
  useViz3DContext: () => ({ captureObjectTopViewPng: () => Promise.resolve(null) }),
}));

const objectOf = (controlType: ControlledObject["controlType"]): ControlledObject => ({
  id: 1,
  name: "O",
  controlType,
  shapePreset: "cube",
  shapeDimensions: { width: 3000, height: 1000, depth: 3000 },
  dimensions: { w: 3000, h: 1000, d: 3000 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  motionParams: { h: { ...MOTION_DEFAULTS.move } },
  maxAxisVelocity: 200,
  pulleyDistance: 0,
  modelRunDirection: 1,
  safetyRadius: 1850,
  initialTiltDirection: 0,
  axes: [
    { key: "0", custom: false, mount: { x: -400, z: 0 } },
    { key: "1", custom: false, mount: { x: 400, z: 0 } },
  ],
  params: {},
});

const renderDialog = (controlType: ControlledObject["controlType"]) =>
  render(
    <DisplayLengthUnitProvider initialUnit="mm">
      <MultiPointAxesDialog
        open
        object={objectOf(controlType)}
        motors={[]}
        plcs={[]}
        onOpenChange={() => {}}
        onApply={() => true}
      />
    </DisplayLengthUnitProvider>,
  );

describe("MultiPointAxesDialog swing params", () => {
  afterEach(cleanup);

  it("shows no mount rotation and no initial tilt for a dual tilt", () => {
    renderDialog("dualTiltFourPointSwing");
    expect(screen.getByLabelText("安全范围半径")).toBeTruthy();
    expect(screen.queryByLabelText("初始倾斜角度")).toBeNull();
    expect(screen.queryByLabelText("吊点旋转")).toBeNull();
  });

  it("keeps the initial tilt for a multi-point swing", () => {
    renderDialog("multiPointSwing");
    expect(screen.getByLabelText("初始倾斜角度")).toBeTruthy();
    expect(screen.queryByLabelText("吊点旋转")).toBeNull();
  });
});
