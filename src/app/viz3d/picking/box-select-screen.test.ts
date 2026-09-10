import { describe, expect, it } from "vitest";
import { isPointInScreenRect, selectIdsInScreenRect } from "./box-select-screen";
import type { ScreenRect } from "../types";

const rect: ScreenRect = { left: 10, top: 20, width: 100, height: 80 };

describe("isPointInScreenRect", () => {
  it("returns true for a point inside the rect", () => {
    expect(isPointInScreenRect(50, 50, rect)).toBe(true);
  });

  it("returns true for a point on the boundary", () => {
    expect(isPointInScreenRect(10, 20, rect)).toBe(true);
    expect(isPointInScreenRect(110, 100, rect)).toBe(true);
  });

  it("returns false for a point outside the rect", () => {
    expect(isPointInScreenRect(9, 50, rect)).toBe(false);
    expect(isPointInScreenRect(50, 101, rect)).toBe(false);
  });
});

describe("selectIdsInScreenRect", () => {
  it("includes id when a corner is inside the rect", () => {
    const ids = selectIdsInScreenRect(rect, [
      {
        id: "a",
        corners: [
          { x: 5, y: 5 },
          { x: 50, y: 50 },
        ],
      },
    ]);

    expect(ids).toEqual(["a"]);
  });

  it("includes id when center is inside the rect", () => {
    const ids = selectIdsInScreenRect(rect, [
      {
        id: "b",
        corners: [
          { x: 200, y: 200 },
          { x: 220, y: 220 },
          { x: 60, y: 60 },
          { x: 80, y: 80 },
        ],
      },
    ]);

    expect(ids).toEqual(["b"]);
  });

  it("includes id when the projected AABB overlaps the marquee even if every corner is outside", () => {
    const ids = selectIdsInScreenRect(rect, [
      {
        id: "surround",
        corners: [
          { x: -50, y: -50 },
          { x: 300, y: -50 },
          { x: -50, y: 300 },
          { x: 300, y: 300 },
        ],
      },
    ]);

    expect(ids).toEqual(["surround"]);
  });

  it("excludes id when the projected AABB misses the marquee", () => {
    const ids = selectIdsInScreenRect(rect, [
      {
        id: "c",
        corners: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
          { x: 5, y: 0 },
        ],
      },
    ]);

    expect(ids).toEqual([]);
  });

  it("returns multiple matching ids", () => {
    const ids = selectIdsInScreenRect(rect, [
      { id: "a", corners: [{ x: 50, y: 50 }] },
      { id: "b", corners: [{ x: 200, y: 200 }] },
      { id: "c", corners: [{ x: 60, y: 60 }] },
    ]);

    expect(ids).toEqual(["a", "c"]);
  });
});
