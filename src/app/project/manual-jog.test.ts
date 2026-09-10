import { describe, expect, it } from "vitest";
import {
  DEFAULT_MANUAL_JOG,
  DIMENSION_KEY_TO_VIRTUAL_AXIS,
  normalizeManualJog,
} from "./manual-jog";

describe("manual-jog", () => {
  it("fills all three axes with defaults when input is undefined", () => {
    expect(normalizeManualJog(undefined)).toEqual(DEFAULT_MANUAL_JOG);
  });

  it("keeps valid values and fills missing axes / invalid values with defaults", () => {
    expect(
      normalizeManualJog({
        v1: { velocity: 42, accelDecelTime: 3 },
        v2: { velocity: -5, accelDecelTime: 99 },
      }),
    ).toEqual({
      v1: { velocity: 42, accelDecelTime: 3 },
      v2: { velocity: DEFAULT_MANUAL_JOG.v2!.velocity, accelDecelTime: 99 },
      v3: DEFAULT_MANUAL_JOG.v3,
    });
  });

  it("maps dimension keys to virtual axes", () => {
    expect(DIMENSION_KEY_TO_VIRTUAL_AXIS).toEqual({
      height: "v1",
      angle: "v1",
      pitch: "v2",
      yaw: "v3",
    });
  });
});
