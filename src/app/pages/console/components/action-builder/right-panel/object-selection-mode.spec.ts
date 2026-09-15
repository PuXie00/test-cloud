import { describe, expect, it } from "vitest";
import {
  objectSelectionModeFromDock,
  preferSequenceProperties,
} from "./object-selection-mode";

describe("objectSelectionModeFromDock", () => {
  it("maps sequence and empty dock modes", () => {
    expect(objectSelectionModeFromDock("sequence")).toBe("sequence");
    expect(objectSelectionModeFromDock("empty")).toBe("empty");
  });
});

describe("preferSequenceProperties", () => {
  it("keeps sequence block properties only while editing a sequence", () => {
    expect(preferSequenceProperties("sequence", { kind: "block", blockId: "b1" })).toBe(true);
    expect(preferSequenceProperties("empty", { kind: "block", blockId: "b1" })).toBe(false);
    expect(preferSequenceProperties("sequence", null)).toBe(false);
  });
});
