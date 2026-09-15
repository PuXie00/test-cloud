import { describe, expect, it } from "vitest";
import {
  FADER_MAX,
  FADER_MIN,
  clampFaderValue,
  faderValueFromClientY,
  stepFaderValue,
} from "./vertical-fader-math";

describe("clampFaderValue", () => {
  it("rounds and clamps to 0–200", () => {
    expect(FADER_MIN).toBe(0);
    expect(FADER_MAX).toBe(200);
    expect(clampFaderValue(100.4)).toBe(100);
    expect(clampFaderValue(100.6)).toBe(101);
    expect(clampFaderValue(-8)).toBe(0);
    expect(clampFaderValue(250)).toBe(200);
  });
});

describe("faderValueFromClientY", () => {
  const track = { top: 0, height: 200 };

  it("maps bottom to 0 and top to 200", () => {
    expect(faderValueFromClientY(200, track)).toBe(0);
    expect(faderValueFromClientY(0, track)).toBe(200);
    expect(faderValueFromClientY(100, track)).toBe(100);
  });

  it("clamps outside the track", () => {
    expect(faderValueFromClientY(-20, track)).toBe(200);
    expect(faderValueFromClientY(260, track)).toBe(0);
  });

  it("returns 0 when height is 0", () => {
    expect(faderValueFromClientY(10, { top: 0, height: 0 })).toBe(0);
  });
});

describe("stepFaderValue", () => {
  it("steps 1 on arrows and 10 on Shift or Page", () => {
    expect(stepFaderValue(100, "ArrowUp", false)).toBe(101);
    expect(stepFaderValue(100, "ArrowRight", false)).toBe(101);
    expect(stepFaderValue(100, "ArrowDown", false)).toBe(99);
    expect(stepFaderValue(100, "ArrowLeft", false)).toBe(99);
    expect(stepFaderValue(100, "ArrowUp", true)).toBe(110);
    expect(stepFaderValue(100, "PageUp", false)).toBe(110);
    expect(stepFaderValue(100, "PageDown", false)).toBe(90);
    expect(stepFaderValue(198, "ArrowUp", true)).toBe(200);
    expect(stepFaderValue(2, "ArrowDown", false)).toBe(1);
    expect(stepFaderValue(0, "ArrowDown", false)).toBe(0);
    expect(stepFaderValue(100, "Home", false)).toBeNull();
  });
});
