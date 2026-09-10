import { describe, expect, it } from "vitest";
import {
  idsNotInCue,
  objectSelectionModeFromDock,
  preferSequenceProperties,
} from "./object-selection-mode";

describe("objectSelectionModeFromDock", () => {
  it("maps cue, sequence, and everything else to empty", () => {
    expect(objectSelectionModeFromDock("cue")).toBe("cue");
    expect(objectSelectionModeFromDock("sequence")).toBe("sequence");
    expect(objectSelectionModeFromDock("empty")).toBe("empty");
    expect(objectSelectionModeFromDock("transition")).toBe("empty");
  });
});

describe("idsNotInCue", () => {
  it("keeps selected ids that are not already in the cue", () => {
    expect(idsNotInCue([7, 8, 9], [8])).toEqual([7, 9]);
  });
});

describe("preferSequenceProperties", () => {
  it("keeps sequence block properties only while editing a sequence", () => {
    expect(preferSequenceProperties("sequence", { kind: "block", blockId: "b1" })).toBe(true);
    expect(preferSequenceProperties("cue", { kind: "block", blockId: "b1" })).toBe(false);
    expect(preferSequenceProperties("sequence", null)).toBe(false);
  });
});
