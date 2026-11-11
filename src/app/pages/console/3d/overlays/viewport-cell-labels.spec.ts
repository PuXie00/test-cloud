import { describe, expect, it } from "vitest";
import { cellTitle, cellViewValue } from "./viewport-cell-labels";

describe("格名", () => {
  it("正交预设显示视图名，其余按投影显示透视 / 正交", () => {
    expect(cellTitle({ preset: "top", orthographic: true })).toBe("顶视图");
    expect(cellTitle({ preset: "side", orthographic: true })).toBe("右视图");
    expect(cellTitle({ preset: "persp", orthographic: false })).toBe("透视");
    expect(cellTitle({ preset: "persp", orthographic: true })).toBe("正交");
  });

  it("「视角」单选：非正交预设都落在「透视」", () => {
    expect(cellViewValue({ preset: "front" })).toBe("front");
    expect(cellViewValue({ preset: "persp" })).toBe("persp");
    expect(cellViewValue({ preset: "iso" })).toBe("persp");
  });
});
