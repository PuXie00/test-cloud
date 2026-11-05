import { describe, expect, it } from "vitest";
import { objectModeSelection } from "./object-mode-pick";

describe("objectModeSelection", () => {
  it("selects the owning object when a hoist is hit, bound or not", () => {
    expect(objectModeSelection({ kind: "hoist-axis", objectId: "7", axisKey: "0", motorId: "21" })).toEqual({
      kind: "object",
      id: "7",
    });
    expect(objectModeSelection({ kind: "hoist-axis", objectId: "7", axisKey: "1", motorId: null })).toEqual({
      kind: "object",
      id: "7",
    });
  });

  it("keeps object hits and misses as they are", () => {
    expect(objectModeSelection({ kind: "object", id: "8" })).toEqual({ kind: "object", id: "8" });
    expect(objectModeSelection(null)).toBeNull();
  });
});
