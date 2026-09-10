import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { beforeEach, describe, expect, it } from "vitest";
import { DriveUnitLabels } from "./DriveUnitLabels";

beforeEach(() => {
  Object.assign(globalThis, {
    document: {
      createElement: () => ({
        className: "",
        textContent: "",
        remove: () => undefined,
      }),
    },
  });
});

describe("DriveUnitLabels", () => {
  it("copies world position so a shared scratch vector cannot move other labels", () => {
    const a = new DriveUnitLabels();
    const b = new DriveUnitLabels();
    const scratch = new Vector3();

    a.setWorldPosition(scratch.set(1, 2, 3));
    b.setWorldPosition(scratch.set(4, 5, 6));

    expect(a.entry.worldPosition.asArray()).toEqual([1, 2, 3]);
    expect(b.entry.worldPosition.asArray()).toEqual([4, 5, 6]);
  });
});
