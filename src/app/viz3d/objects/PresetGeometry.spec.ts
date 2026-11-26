import { describe, expect, it } from "vitest";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import {
  buildPresetVertexData,
  resolvePresetGeometry,
  type Dimensions,
  type HoleDimensions,
} from "./PresetGeometry";
import type { PresetShape } from "../types";
import { toEngineHoleDimensions } from "@/app/pages/console/components/right-sidebar/config-wizard/config-descriptors";
import { createShapeFootprint, getFootprintBounds } from "@/app/pages/console/components/right-sidebar/config-wizard/multi-point-axes/multi-point-axes-geometry";

const EPS = 1e-6;

const build = (shape: PresetShape, dims: Dimensions, hole?: HoleDimensions) => {
  const data = buildPresetVertexData(resolvePresetGeometry(shape, dims, hole));
  if (!data) throw new Error(`${shape} 没有自建几何`);
  const positions = Array.from(data.positions!);
  const normals = Array.from(data.normals!);
  const indices = Array.from(data.indices!);
  const vertex = (index: number) => ({
    x: positions[index * 3]!,
    y: positions[index * 3 + 1]!,
    z: positions[index * 3 + 2]!,
  });
  const normal = (index: number) => ({
    x: normals[index * 3]!,
    y: normals[index * 3 + 1]!,
    z: normals[index * 3 + 2]!,
  });
  const vertexCount = positions.length / 3;
  const triangles = Array.from({ length: indices.length / 3 }, (_, index) => [
    indices[index * 3]!,
    indices[index * 3 + 1]!,
    indices[index * 3 + 2]!,
  ]);
  return { positions, normals, indices, vertex, normal, vertexCount, triangles };
};

type Built = ReturnType<typeof build>;

const bounds = ({ vertex, vertexCount }: Built) => {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let index = 0; index < vertexCount; index += 1) {
    const v = vertex(index);
    for (const key of ["x", "y", "z"] as const) {
      min[key] = Math.min(min[key], v[key]);
      max[key] = Math.max(max[key], v[key]);
    }
  }
  return { min, max };
};

/** 用 Babylon 自己的 ComputeNormals 按三角形绕序重算法线，应与给出的法线同向（正面朝外、不会被背面剔除） */
const expectWindingMatchesNormals = (built: Built) => {
  const computed: number[] = [];
  VertexData.ComputeNormals(built.positions, built.indices, computed);
  for (let index = 0; index < built.vertexCount; index += 1) {
    const dot =
      computed[index * 3]! * built.normals[index * 3]! +
      computed[index * 3 + 1]! * built.normals[index * 3 + 1]! +
      computed[index * 3 + 2]! * built.normals[index * 3 + 2]!;
    expect(dot).toBeGreaterThan(0.95);
  }
};

/** XZ 平面上的点是否落在某个三角形（投影）里——用来判断从正上方看中心有没有被盖住 */
const coversPointFromAbove = (built: Built, point: { x: number; z: number }) =>
  built.triangles.some(([a, b, c]) => {
    const [p, q, r] = [built.vertex(a!), built.vertex(b!), built.vertex(c!)];
    const cross = (u: typeof p, v: typeof p) =>
      (v.x - u.x) * (point.z - u.z) - (v.z - u.z) * (point.x - u.x);
    const d1 = cross(p, q);
    const d2 = cross(q, r);
    const d3 = cross(r, p);
    const hasNeg = d1 < -EPS || d2 < -EPS || d3 < -EPS;
    const hasPos = d1 > EPS || d2 > EPS || d3 > EPS;
    const area = Math.abs((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
    return area > EPS && !(hasNeg && hasPos);
  });

const sideNormals = (built: Built) => {
  const result: { x: number; y: number; z: number }[] = [];
  for (let index = 0; index < built.vertexCount; index += 1) {
    const n = built.normal(index);
    if (Math.abs(n.y) < EPS) result.push(n);
  }
  return result;
};

const distinctDirections = (normals: { x: number; z: number }[]) => {
  const keys = new Set(normals.map((n) => `${n.x.toFixed(4)},${n.z.toFixed(4)}`));
  return keys.size;
};

describe("圆环（矩形截面）", () => {
  const dims = { w: 2, h: 0.2, d: 2 };
  const hole = { w: 1.2, d: 1.2 };

  it("外径、内径、厚度按尺寸字段，外框正好是 w × h × d", () => {
    const built = build("ring", dims, hole);
    const { min, max } = bounds(built);
    expect(max.x - min.x).toBeCloseTo(2, 6);
    expect(max.z - min.z).toBeCloseTo(2, 6);
    expect(min.y).toBeCloseTo(-0.1, 6);
    expect(max.y).toBeCloseTo(0.1, 6);
    for (let index = 0; index < built.vertexCount; index += 1) {
      const v = built.vertex(index);
      const radius = Math.hypot(v.x, v.z);
      expect(radius).toBeGreaterThan(0.6 - EPS);
      expect(radius).toBeLessThan(1 + EPS);
    }
  });

  it("截面是矩形：顶点只在上下两个平面，半径只有内、外两种", () => {
    const built = build("ring", dims, hole);
    const ys = new Set<string>();
    const radii = new Set<string>();
    for (let index = 0; index < built.vertexCount; index += 1) {
      const v = built.vertex(index);
      ys.add(v.y.toFixed(6));
      radii.add(Math.hypot(v.x, v.z).toFixed(6));
    }
    expect([...ys].sort()).toEqual(["-0.100000", "0.100000"]);
    expect([...radii].sort()).toEqual(["0.600000", "1.000000"]);
  });

  it("顶 / 底面法线竖直，内外壁法线水平且分别朝外 / 朝中心", () => {
    const built = build("ring", dims, hole);
    let outward = 0;
    let inward = 0;
    for (let index = 0; index < built.vertexCount; index += 1) {
      const v = built.vertex(index);
      const n = built.normal(index);
      const isCap = Math.abs(Math.abs(n.y) - 1) < EPS;
      if (isCap) {
        expect(Math.sign(n.y)).toBe(Math.sign(v.y));
        continue;
      }
      expect(n.y).toBeCloseTo(0, 6);
      const radial = (n.x * v.x + n.z * v.z) / Math.hypot(v.x, v.z);
      if (Math.hypot(v.x, v.z) > 0.8) {
        expect(radial).toBeCloseTo(1, 6);
        outward += 1;
      } else {
        expect(radial).toBeCloseTo(-1, 6);
        inward += 1;
      }
    }
    expect(outward).toBeGreaterThan(0);
    expect(inward).toBeGreaterThan(0);
  });

  it("中间镂空，绕序正确", () => {
    const built = build("ring", dims, hole);
    expect(coversPointFromAbove(built, { x: 0, z: 0 })).toBe(false);
    expect(coversPointFromAbove(built, { x: 0.8, z: 0 })).toBe(true);
    expectWindingMatchesNormals(built);
  });

  it("没传内径时按外径 0.6 回退；内径过大时夹到外径以内", () => {
    const fallback = resolvePresetGeometry("ring", dims);
    expect(fallback).toMatchObject({ kind: "annulus", params: { innerDiameter: 1.2 } });
    const tooBig = resolvePresetGeometry("ring", dims, { w: 3, d: 3 });
    expect(tooBig.kind === "annulus" && tooBig.params.innerDiameter < 2).toBe(true);
  });
});

describe("方环", () => {
  const dims = { w: 2, h: 0.2, d: 1.5 };
  const hole = { w: 1.6, d: 1.1 };

  it("中间是空的：从上往下看中心没有面，环上有面", () => {
    const built = build("sqRing", dims, hole);
    expect(coversPointFromAbove(built, { x: 0, z: 0 })).toBe(false);
    expect(coversPointFromAbove(built, { x: 0.7, z: 0.5 })).toBe(false);
    expect(coversPointFromAbove(built, { x: 0.9, z: 0 })).toBe(true);
    expect(coversPointFromAbove(built, { x: 0, z: 0.65 })).toBe(true);
  });

  it("外框 w × h × d，内框按内宽 / 内深，四个外壁 + 四个内壁各自平面", () => {
    const built = build("sqRing", dims, hole);
    const { min, max } = bounds(built);
    expect(max.x - min.x).toBeCloseTo(2, 6);
    expect(max.z - min.z).toBeCloseTo(1.5, 6);
    expect(max.y - min.y).toBeCloseTo(0.2, 6);
    const innerXs = new Set<string>();
    for (let index = 0; index < built.vertexCount; index += 1) {
      const v = built.vertex(index);
      if (Math.abs(v.x) < 0.95) innerXs.add(Math.abs(v.x).toFixed(6));
    }
    expect([...innerXs]).toEqual(["0.800000"]);
    expect(distinctDirections(sideNormals(built))).toBe(4);
    expectWindingMatchesNormals(built);
  });

  it("没传内框时按环宽 = 0.2 × 短边回退", () => {
    const fallback = resolvePresetGeometry("sqRing", dims);
    if (fallback.kind !== "frame") throw new Error("应为 frame");
    expect(fallback.params.innerWidth).toBeCloseTo(1.4, 9);
    expect(fallback.params.innerDepth).toBeCloseTo(0.9, 9);
  });
});

describe("六棱柱", () => {
  const dims = { w: 0.8, h: 2.5, d: 0.8 };

  it("每个侧面一个法线（平面着色），棱边不平滑", () => {
    const built = build("prism6", dims);
    const sides = sideNormals(built);
    expect(distinctDirections(sides)).toBe(6);
    // 同一侧面的 4 个顶点法线完全相同，且垂直于该面
    for (let index = 0; index < built.vertexCount; index += 1) {
      const n = built.normal(index);
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 6);
    }
    const computed: number[] = [];
    VertexData.ComputeNormals(built.positions, built.indices, computed);
    for (let index = 0; index < built.normals.length; index += 1) {
      expect(computed[index]).toBeCloseTo(built.normals[index]!, 6);
    }
  });

  it("对边距 = acrossFlats（±X 两面），棱角在 ±Z，与吊点布置的足迹一致", () => {
    const built = build("prism6", dims);
    const { min, max } = bounds(built);
    expect(max.x - min.x).toBeCloseTo(0.8, 6);
    expect(max.z - min.z).toBeCloseTo((0.8 * 2) / Math.sqrt(3), 6);
    expect(max.y - min.y).toBeCloseTo(2.5, 6);

    const footprint = getFootprintBounds(
      createShapeFootprint({
        shapePreset: "prism6",
        shapeDimensions: { acrossFlats: 800, height: 2500 },
        dimensions: { w: 800, h: 2500, d: 800 },
      }),
    );
    expect((footprint.maxX - footprint.minX) / 1000).toBeCloseTo(max.x - min.x, 6);
    expect((footprint.maxZ - footprint.minZ) / 1000).toBeCloseTo(max.z - min.z, 6);
  });
});

describe("toEngineHoleDimensions", () => {
  it("圆环取内径，方环取外框减两倍环宽，其它形状没有", () => {
    expect(
      toEngineHoleDimensions("ring", { outerDiameter: 2000, innerDiameter: 1500, thickness: 200 }),
    ).toEqual({ w: 1500, d: 1500 });
    expect(
      toEngineHoleDimensions("sqRing", {
        outerWidth: 2000,
        outerDepth: 1500,
        ringWidth: 200,
        thickness: 200,
      }),
    ).toEqual({ w: 1600, d: 1100 });
    expect(toEngineHoleDimensions("prism6", { acrossFlats: 800, height: 2500 })).toBeUndefined();
    expect(toEngineHoleDimensions("ring", undefined)).toBeUndefined();
  });
});
