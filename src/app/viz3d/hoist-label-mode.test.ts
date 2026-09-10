import { describe, expect, it } from "vitest";
import {
  parseHoistLabelMode,
  resolveHoistLabelText,
  UNBOUND_HOIST_LABEL_TEXT,
} from "./hoist-label-mode";

describe("parseHoistLabelMode", () => {
  it("keeps hoist and motor", () => {
    expect(parseHoistLabelMode("hoist")).toBe("hoist");
    expect(parseHoistLabelMode("motor")).toBe("motor");
  });

  it("falls back to hoist for empty or garbage", () => {
    expect(parseHoistLabelMode(null)).toBe("hoist");
    expect(parseHoistLabelMode("")).toBe("hoist");
    expect(parseHoistLabelMode("axis")).toBe("hoist");
  });
});

describe("resolveHoistLabelText", () => {
  it("always uses 1-based hoist index in hoist mode", () => {
    expect(resolveHoistLabelText("hoist", 0, 4)).toBe("1");
    expect(resolveHoistLabelText("hoist", 2, null)).toBe("3");
  });

  it("uses 1-based motor display index when bound", () => {
    expect(resolveHoistLabelText("motor", 0, 0)).toBe("1");
    expect(resolveHoistLabelText("motor", 5, 3)).toBe("4");
  });

  it("uses placeholder when unbound or motor missing", () => {
    expect(resolveHoistLabelText("motor", 0, null)).toBe(UNBOUND_HOIST_LABEL_TEXT);
    expect(UNBOUND_HOIST_LABEL_TEXT).toBe("—");
  });
});
