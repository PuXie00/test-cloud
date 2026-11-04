import { describe, expect, it } from "vitest";
import { alignByBounds, distributeByBounds, type AlignBoundsItem } from "./SceneBuildTools";

const item = (
  id: string,
  position: { x: number; y: number; z: number },
  half: { x: number; y: number; z: number },
): AlignBoundsItem => ({
  id,
  position,
  min: {
    x: position.x - half.x,
    y: position.y - half.y,
    z: position.z - half.z,
  },
  max: {
    x: position.x + half.x,
    y: position.y + half.y,
    z: position.z + half.z,
  },
});

describe("alignByBounds", () => {
  const wide = item("wide", { x: 0, y: 0, z: 0 }, { x: 2, y: 1, z: 1 });
  const small = item("small", { x: 10, y: 6, z: 3 }, { x: 0.5, y: 0.5, z: 0.5 });

  it("aligns top edges to the selection top bound", () => {
    const next = alignByBounds([wide, small], "y", "max");
    expect(next.wide.y).toBe(5.5);
    expect(next.small.y).toBe(6);
  });

  it("aligns bottom edges to the selection bottom bound", () => {
    const next = alignByBounds([wide, small], "y", "min");
    expect(next.wide.y).toBe(0);
    expect(next.small.y).toBe(-0.5);
  });

  it("aligns centers on x without touching the other axes", () => {
    const next = alignByBounds([wide, small], "x", "center");
    expect(next.wide).toEqual({ x: 4.25, y: 0, z: 0 });
    expect(next.small).toEqual({ x: 4.25, y: 6, z: 3 });
  });

  it("aligns centers on y", () => {
    const next = alignByBounds([wide, small], "y", "center");
    expect(next.wide.y).toBe(2.75);
    expect(next.small.y).toBe(2.75);
    expect(next.small.x).toBe(10);
  });

  it("aligns x min edges to the selection's smallest x", () => {
    const next = alignByBounds([wide, small], "x", "min");
    expect(next.wide.x).toBe(0);
    expect(next.small).toEqual({ x: -1.5, y: 6, z: 3 });
  });

  it("aligns x max edges to the selection's largest x", () => {
    const next = alignByBounds([wide, small], "x", "max");
    expect(next.wide.x).toBe(8.5);
    expect(next.small.x).toBe(10);
  });

  it("aligns z min and max edges", () => {
    expect(alignByBounds([wide, small], "z", "min").small.z).toBe(-0.5);
    const max = alignByBounds([wide, small], "z", "max");
    expect(max.wide).toEqual({ x: 0, y: 0, z: 2.5 });
    expect(max.small.z).toBe(3);
  });

  it("aligns centers on z, which had no tool before", () => {
    const next = alignByBounds([wide, small], "z", "center");
    expect(next.wide).toEqual({ x: 0, y: 0, z: 1.25 });
    expect(next.small).toEqual({ x: 10, y: 6, z: 1.25 });
  });

  it("keeps the selection at its current location instead of the origin", () => {
    const a = item("a", { x: 100, y: 50, z: 20 }, { x: 2, y: 1, z: 1 });
    const b = item("b", { x: 110, y: 56, z: 23 }, { x: 0.5, y: 0.5, z: 0.5 });
    const next = alignByBounds([a, b], "y", "min");
    expect(next.a).toEqual({ x: 100, y: 50, z: 20 });
    expect(next.b).toEqual({ x: 110, y: 49.5, z: 23 });
  });

  it("uses the bounds, so an off-center origin still lines up by its edges", () => {
    const offCenter: AlignBoundsItem = {
      id: "off",
      position: { x: 0, y: 3, z: 0 },
      min: { x: -1, y: 0, z: -1 },
      max: { x: 1, y: 2, z: 1 },
    };
    const next = alignByBounds([offCenter, item("b", { x: 5, y: 10, z: 0 }, { x: 1, y: 1, z: 1 })], "y", "max");
    expect(next.off.y).toBe(11 - 2 + 3);
  });

  it("leaves a single object alone", () => {
    expect(alignByBounds([wide], "x", "center").wide).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("distributeByBounds", () => {
  const half = { x: 1, y: 1, z: 1 };

  it("spaces same-size objects evenly and keeps the outer two in place", () => {
    const next = distributeByBounds(
      [
        item("a", { x: 0, y: 0, z: 0 }, half),
        item("b", { x: 2.5, y: 0, z: 0 }, half),
        item("c", { x: 3, y: 0, z: 0 }, half),
        item("d", { x: 12, y: 0, z: 0 }, half),
      ],
      "x",
    );
    expect(next.a.x).toBe(0);
    expect(next.b.x).toBe(4);
    expect(next.c.x).toBe(8);
    expect(next.d.x).toBe(12);
  });

  it("makes the gaps equal when sizes differ", () => {
    const next = distributeByBounds(
      [
        item("a", { x: 0, y: 0, z: 0 }, { x: 3, y: 1, z: 1 }),
        item("b", { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
        item("c", { x: 20, y: 0, z: 0 }, { x: 3, y: 1, z: 1 }),
      ],
      "x",
    );
    // a 右缘 3，c 左缘 17，b 宽 2：两段间隙都是 6
    expect(next.b.x).toBe(10);
  });

  it("orders by position, not selection order", () => {
    const next = distributeByBounds(
      [
        item("far", { x: 0, y: 0, z: 10 }, half),
        item("near", { x: 0, y: 0, z: 0 }, half),
        item("mid", { x: 0, y: 0, z: 2 }, half),
      ],
      "z",
    );
    expect(next.near.z).toBe(0);
    expect(next.mid.z).toBe(5);
    expect(next.far.z).toBe(10);
  });

  it("only moves along the chosen axis", () => {
    const next = distributeByBounds(
      [
        item("a", { x: 0, y: 1, z: 2 }, half),
        item("b", { x: 1, y: 3, z: 4 }, half),
        item("c", { x: 10, y: 5, z: 6 }, half),
      ],
      "x",
    );
    expect(next.b).toEqual({ x: 5, y: 3, z: 4 });
  });

  it("works on height", () => {
    const next = distributeByBounds(
      [
        item("a", { x: 0, y: 0, z: 0 }, half),
        item("b", { x: 0, y: 1, z: 0 }, half),
        item("c", { x: 0, y: 8, z: 0 }, half),
      ],
      "y",
    );
    expect(next.b.y).toBe(4);
  });

  it("measures from the bounds when the origin is off-center", () => {
    const low: AlignBoundsItem = {
      id: "low",
      position: { x: 0, y: 100, z: 0 },
      min: { x: 0, y: 0, z: 0 },
      max: { x: 2, y: 2, z: 2 },
    };
    const next = distributeByBounds(
      [
        low,
        { ...low, id: "mid", min: { x: 1, y: 0, z: 0 }, max: { x: 3, y: 2, z: 2 } },
        { ...low, id: "end", min: { x: 10, y: 0, z: 0 }, max: { x: 12, y: 2, z: 2 } },
      ],
      "x",
    );
    // mid 的左缘从 1 移到 5，position 同步平移 4
    expect(next.mid.x).toBe(4);
  });

  it("stays put when the objects are already evenly spaced", () => {
    const items = [
      item("a", { x: 0, y: 0, z: 0 }, half),
      item("b", { x: 5, y: 0, z: 0 }, half),
      item("c", { x: 10, y: 0, z: 0 }, half),
    ];
    const next = distributeByBounds(items, "x");
    expect(next.b.x).toBe(5);
  });

  it("stays put when every object sits at the same spot", () => {
    const items = ["a", "b", "c"].map((id) => item(id, { x: 2, y: 0, z: 0 }, half));
    const next = distributeByBounds(items, "x");
    expect([next.a.x, next.b.x, next.c.x]).toEqual([2, 2, 2]);
  });

  it("needs at least three objects", () => {
    const next = distributeByBounds(
      [item("a", { x: 0, y: 0, z: 0 }, half), item("b", { x: 3, y: 0, z: 0 }, half)],
      "x",
    );
    expect(next.a.x).toBe(0);
    expect(next.b.x).toBe(3);
  });
});
