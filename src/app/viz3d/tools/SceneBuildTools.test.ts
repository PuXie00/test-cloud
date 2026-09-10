import { describe, expect, it } from "vitest";
import { alignByBounds, type AlignBoundsItem } from "./SceneBuildTools";

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

  it("aligns left edges to the selection left bound", () => {
    const next = alignByBounds([wide, small], "left");
    expect(next.wide.x).toBe(0);
    expect(next.small.x).toBe(-1.5);
    expect(next.small.y).toBe(6);
    expect(next.small.z).toBe(3);
  });

  it("aligns right edges to the selection right bound", () => {
    const next = alignByBounds([wide, small], "right");
    expect(next.wide.x).toBe(8.5);
    expect(next.small.x).toBe(10);
  });

  it("aligns horizontal centers to the selection center x", () => {
    const next = alignByBounds([wide, small], "hCenter");
    expect(next.wide.x).toBe(4.25);
    expect(next.small.x).toBe(4.25);
    expect(next.small.y).toBe(6);
  });

  it("aligns top edges to the selection top bound", () => {
    const next = alignByBounds([wide, small], "top");
    expect(next.wide.y).toBe(5.5);
    expect(next.small.y).toBe(6);
  });

  it("aligns bottom edges to the selection bottom bound", () => {
    const next = alignByBounds([wide, small], "bottom");
    expect(next.wide.y).toBe(0);
    expect(next.small.y).toBe(-0.5);
  });

  it("aligns vertical centers to the selection center y", () => {
    const next = alignByBounds([wide, small], "vCenter");
    expect(next.wide.y).toBe(2.75);
    expect(next.small.y).toBe(2.75);
    expect(next.small.x).toBe(10);
  });

  it("aligns both centers without changing z", () => {
    const next = alignByBounds([wide, small], "center");
    expect(next.wide).toEqual({ x: 4.25, y: 2.75, z: 0 });
    expect(next.small).toEqual({ x: 4.25, y: 2.75, z: 3 });
  });

  it("keeps the selection at its current location instead of the origin", () => {
    const a = item("a", { x: 100, y: 50, z: 20 }, { x: 2, y: 1, z: 1 });
    const b = item("b", { x: 110, y: 56, z: 23 }, { x: 0.5, y: 0.5, z: 0.5 });
    const next = alignByBounds([a, b], "left");
    expect(next.a).toEqual({ x: 100, y: 50, z: 20 });
    expect(next.b).toEqual({ x: 98.5, y: 56, z: 23 });
  });
});
