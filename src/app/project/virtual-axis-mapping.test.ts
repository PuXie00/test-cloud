import { describe, expect, it } from "vitest";
import type { MotionAxisKind } from "./configuration-types";
import {
  motionKindForVirtualAxis,
  virtualAxisDescriptor,
  virtualAxisForMotionKind,
  virtualAxisMotionKinds,
} from "./virtual-axis-mapping";

const moveOnly: MotionAxisKind[] = ["move"];
const rotationOnly: MotionAxisKind[] = ["rotation"];
const swingXOnly: MotionAxisKind[] = ["move", "swingX"];
const swingYOnly: MotionAxisKind[] = ["move", "swingX", "swingY"];
const yawYOnly: MotionAxisKind[] = ["move", "swingX", "yawY"];

describe("motionKindForVirtualAxis", () => {
  it("v2 is always swingX", () => {
    expect(motionKindForVirtualAxis(swingXOnly, "v2")).toBe("swingX");
    expect(motionKindForVirtualAxis(swingYOnly, "v2")).toBe("swingX");
  });

  it("v3 picks swingY when present, else yawY", () => {
    expect(motionKindForVirtualAxis(swingYOnly, "v3")).toBe("swingY");
    expect(motionKindForVirtualAxis(yawYOnly, "v3")).toBe("yawY");
  });

  it("v1 picks rotation when present, else move", () => {
    expect(motionKindForVirtualAxis(rotationOnly, "v1")).toBe("rotation");
    expect(motionKindForVirtualAxis(moveOnly, "v1")).toBe("move");
  });
});

describe("virtualAxisMotionKinds", () => {
  it("maps enabled axes in order", () => {
    expect(virtualAxisMotionKinds(swingYOnly, ["v1", "v2", "v3"])).toEqual([
      { axis: "v1", kind: "move" },
      { axis: "v2", kind: "swingX" },
      { axis: "v3", kind: "swingY" },
    ]);
  });

  it("skips disabled axes", () => {
    expect(virtualAxisMotionKinds(swingXOnly, ["v1", "v2"])).toEqual([
      { axis: "v1", kind: "move" },
      { axis: "v2", kind: "swingX" },
    ]);
  });
});

describe("virtualAxisDescriptor", () => {
  it("v1 is rotation (°) when motionAxes includes rotation", () => {
    expect(virtualAxisDescriptor(["rotation"], "v1")).toEqual({
      key: "angle",
      label: "旋转",
      unit: "°",
    });
  });

  it("v1 is move (mm) otherwise", () => {
    expect(virtualAxisDescriptor(["move"], "v1")).toEqual({
      key: "height",
      label: "升降",
      unit: "mm",
    });
  });

  it("v2 is always swingX", () => {
    expect(virtualAxisDescriptor(["move", "swingX"], "v2")).toEqual({
      key: "pitch",
      label: "摆动 X",
      unit: "°",
    });
  });

  it("v3 picks swingY, else yawY", () => {
    expect(virtualAxisDescriptor(["move", "swingX", "swingY"], "v3")).toEqual({
      key: "yaw",
      label: "摆动 Y",
      unit: "°",
    });
    expect(virtualAxisDescriptor(["move", "swingX", "yawY"], "v3")).toEqual({
      key: "yaw",
      label: "偏转",
      unit: "°",
    });
  });
});

describe("virtualAxisForMotionKind", () => {
  it("maps swing/move/rotation kinds to virtual axes", () => {
    expect(virtualAxisForMotionKind("move")).toBe("v1");
    expect(virtualAxisForMotionKind("rotation")).toBe("v1");
    expect(virtualAxisForMotionKind("swingX")).toBe("v2");
    expect(virtualAxisForMotionKind("swingY")).toBe("v3");
    expect(virtualAxisForMotionKind("yawY")).toBe("v3");
  });
});
