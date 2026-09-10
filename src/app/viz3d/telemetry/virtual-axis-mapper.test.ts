import { describe, expect, it } from "vitest";
import { resolveVirtualAxisTransform } from "./virtual-axis-mapper";
import type { SceneObjectConfig } from "../types";

const base: SceneObjectConfig = {
  id: "co-1",
  shape: "cube",
  dimensions: { w: 2, h: 1, d: 1 },
  position: { x: 10, y: 4, z: -2 },
  centerOffset: { x: 0, y: 0, z: 0 },
  color: "#4cd6fb",
  virtualAxes: [
    { axis: "v1", kind: "move" },
    { axis: "v2", kind: "swingX" },
    { axis: "v3", kind: "swingY" },
  ],
  modelRunDirection: 1,
};

describe("resolveVirtualAxisTransform", () => {
  it("move v1 shifts position.y (mm → m)", () => {
    const t = resolveVirtualAxisTransform(base, { v1: 1500, v2: 0, v3: 0 });
    expect(t.position).toEqual({ x: 10, y: 5.5, z: -2 });
    expect(t.rotation).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("swingX and swingY rotate (° → rad)", () => {
    const t = resolveVirtualAxisTransform(base, { v1: 0, v2: 45, v3: -30 });
    expect(t.rotation.x).toBeCloseTo((45 * Math.PI) / 180, 5);
    expect(t.rotation.y).toBeCloseTo((-30 * Math.PI) / 180, 5);
  });

  it("modelRunDirection 2 flips sign", () => {
    const rev = { ...base, modelRunDirection: 2 as const };
    const t = resolveVirtualAxisTransform(rev, { v1: 1000, v2: 0, v3: 0 });
    expect(t.position.y).toBeCloseTo(3, 5);
  });

  it("missing values default to 0", () => {
    const t = resolveVirtualAxisTransform(base, {});
    expect(t.position).toEqual(base.position);
    expect(t.rotation).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("rotation kind v1 writes rotation.y", () => {
    const rot: SceneObjectConfig = {
      ...base,
      virtualAxes: [{ axis: "v1", kind: "rotation" }],
    };
    const t = resolveVirtualAxisTransform(rot, { v1: 90 });
    expect(t.rotation.y).toBeCloseTo(Math.PI / 2, 5);
    expect(t.position.y).toBe(base.position.y);
  });

  it("no virtualAxes leaves transform unchanged", () => {
    const t = resolveVirtualAxisTransform({ ...base, virtualAxes: undefined }, { v1: 999 });
    expect(t.position).toEqual(base.position);
    expect(t.rotation).toEqual({ x: 0, y: 0, z: 0 });
  });
});
