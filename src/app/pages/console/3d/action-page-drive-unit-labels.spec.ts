import { describe, expect, it } from "vitest";
import { collectActionPageDriveUnitLabels } from "./action-page-drive-unit-labels";
import type { ModelPose } from "@/app/project/action-sequence/types";

const pose = (v1: number, v2 = 0, v3 = 0): ModelPose => ({ v1, v2, v3 });

describe("collectActionPageDriveUnitLabels", () => {
  const objects = [
    { id: 7, controlType: "fourPointSwing" as const },
    { id: 8, controlType: "fourPointSwing" as const },
    { id: 9, controlType: "staticProp" as const },
  ];

  it("labels every cue/sequence member, using install zeros when pose is missing", () => {
    const labels = collectActionPageDriveUnitLabels(
      new Map([[7, pose(1234, 5, -3)]]),
      objects,
      "mm",
      new Set([7, 8]),
    );
    expect(labels.get("7")).toBe("1234mm/5°/-3°");
    expect(labels.get("8")).toBe("0mm/0°/0°");
    expect(labels.has("9")).toBe(false);
  });

  it("does not label objects outside the current cue/sequence", () => {
    const labels = collectActionPageDriveUnitLabels(
      new Map([
        [7, pose(1234)],
        [8, pose(50)],
      ]),
      objects,
      "mm",
      new Set([7]),
    );
    expect(labels.get("7")).toBe("1234mm/0°/0°");
    expect(labels.get("8")).toBeNull();
  });

  it("clears all labels when there is no cue or sequence", () => {
    const labels = collectActionPageDriveUnitLabels(
      new Map([[7, pose(1234)]]),
      objects,
      "mm",
      null,
    );
    expect(labels.get("7")).toBeNull();
    expect(labels.get("8")).toBeNull();
  });
});
