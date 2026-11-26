import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { PresetShape } from "../types";

export type Dimensions = { w: number; h: number; d: number };

/** 中空部分在 XZ 面上的尺寸（米）：圆环 w = d = 内径；方环为内框宽 / 深 */
export type HoleDimensions = { w: number; d: number };

export type PresetGeometryDescriptor =
  | { kind: "box"; params: { width: number; height: number; depth: number } }
  | { kind: "sphere"; params: { diameter: number; segments: number } }
  | {
      kind: "cylinder";
      params: { diameterTop: number; diameterBottom: number; height: number; tessellation: number };
    }
  /** 圆环：矩形截面（外径 / 内径 / 厚度），像厚垫圈；innerDiameter 为 0 时是实心圆柱 */
  | {
      kind: "annulus";
      params: { outerDiameter: number; innerDiameter: number; height: number; segments: number };
    }
  /** 方环：外框 outerWidth × outerDepth 挖掉内框 innerWidth × innerDepth；内框为 0 时是实心长方体 */
  | {
      kind: "frame";
      params: {
        outerWidth: number;
        outerDepth: number;
        innerWidth: number;
        innerDepth: number;
        height: number;
      };
    }
  /** 正多棱柱：acrossFlats 为对边距，两条对边朝 ±X、棱角朝 ±Z（与吊点布置的足迹一致） */
  | { kind: "prism"; params: { acrossFlats: number; height: number; sides: number } };

const RING_SEGMENTS = 64;
const PRISM_SIDES = 6;
/** 尺寸里没给中空参数时的回退，与 setup-persist 的 deriveShapeDimensions 一致 */
const FALLBACK_RING_INNER_RATIO = 0.6;
const FALLBACK_SQ_RING_WIDTH_RATIO = 0.2;
/** 内径 / 内框最多占外框的比例，避免壁厚为 0 时出现退化面 */
const MAX_HOLE_RATIO = 0.98;

const clampHole = (inner: number, outer: number): number => {
  if (!Number.isFinite(inner) || inner <= 0) return 0;
  return Math.min(inner, outer * MAX_HOLE_RATIO);
};

export const resolvePresetGeometry = (
  shape: PresetShape,
  dims: Dimensions,
  hole?: HoleDimensions,
): PresetGeometryDescriptor => {
  switch (shape) {
    case "cube":
      return { kind: "box", params: { width: dims.w, height: dims.h, depth: dims.d } };
    case "sphere": {
      const diameter = Math.max(dims.w, dims.h, dims.d);
      return { kind: "sphere", params: { diameter, segments: 24 } };
    }
    case "cyl": {
      return {
        kind: "cylinder",
        params: { diameterTop: dims.w, diameterBottom: dims.w, height: dims.h, tessellation: 24 },
      };
    }
    case "prism6": {
      return {
        kind: "prism",
        params: { acrossFlats: dims.w, height: dims.h, sides: PRISM_SIDES },
      };
    }
    case "ring": {
      const outerDiameter = dims.w;
      const innerDiameter = clampHole(
        hole ? hole.w : outerDiameter * FALLBACK_RING_INNER_RATIO,
        outerDiameter,
      );
      return {
        kind: "annulus",
        params: { outerDiameter, innerDiameter, height: dims.h, segments: RING_SEGMENTS },
      };
    }
    case "sqRing": {
      const ringWidth = Math.min(dims.w, dims.d) * FALLBACK_SQ_RING_WIDTH_RATIO;
      const rawInner = hole ?? { w: dims.w - 2 * ringWidth, d: dims.d - 2 * ringWidth };
      let innerWidth = clampHole(rawInner.w, dims.w);
      let innerDepth = clampHole(rawInner.d, dims.d);
      // 只有一个方向有洞时两条边会贴在一起，不如当实心处理
      if (innerWidth === 0 || innerDepth === 0) {
        innerWidth = 0;
        innerDepth = 0;
      }
      return {
        kind: "frame",
        params: { outerWidth: dims.w, outerDepth: dims.d, innerWidth, innerDepth, height: dims.h },
      };
    }
  }
};

type Point2D = { x: number; z: number };

type ExtrudeOptions = {
  /** 外轮廓（XZ），围绕原点的凸多边形 */
  outer: readonly Point2D[];
  /** 内轮廓（XZ），点数与外轮廓相同、按同一顺序一一对应；null 表示实心 */
  inner: readonly Point2D[] | null;
  height: number;
  /** true：侧面按径向插值法线（圆环外 / 内壁）；false：每个侧面一个法线，棱边清楚 */
  smoothSides: boolean;
};

/**
 * 把 XZ 轮廓沿 Y 拉伸成立体，y ∈ [-height/2, height/2]。
 * 顶面、底面、每个侧面各用自己的顶点，不共享法线，所以面与面之间的棱边是硬的。
 */
export const buildExtrudedVertexData = ({
  outer,
  inner,
  height,
  smoothSides,
}: ExtrudeOptions): VertexData => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const half = height / 2;
  const count = outer.length;
  const extent = Math.max(
    1e-9,
    ...outer.map((point) => Math.max(Math.abs(point.x), Math.abs(point.z)) * 2),
  );

  const pushVertex = (x: number, y: number, z: number, n: readonly number[], u: number, v: number) => {
    positions.push(x, y, z);
    normals.push(n[0]!, n[1]!, n[2]!);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };

  /** 按期望法线排三角形顶点顺序（Babylon 的正面：(p0-p1)×(p2-p1) 与法线同向） */
  const pushTriangle = (a: number, b: number, c: number, n: readonly number[]) => {
    const ax = positions[a * 3]!;
    const ay = positions[a * 3 + 1]!;
    const az = positions[a * 3 + 2]!;
    const ux = positions[b * 3]! - ax;
    const uy = positions[b * 3 + 1]! - ay;
    const uz = positions[b * 3 + 2]! - az;
    const vx = positions[c * 3]! - ax;
    const vy = positions[c * 3 + 1]! - ay;
    const vz = positions[c * 3 + 2]! - az;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const rightHanded = cx * n[0]! + cy * n[1]! + cz * n[2]!;
    if (rightHanded > 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  };

  const capUv = (point: Point2D): [number, number] => [
    point.x / extent + 0.5,
    point.z / extent + 0.5,
  ];

  // 顶面、底面
  for (const [y, ny] of [
    [half, 1],
    [-half, -1],
  ] as const) {
    const n = [0, ny, 0];
    if (inner) {
      for (let index = 0; index < count; index += 1) {
        const next = (index + 1) % count;
        const quad = [outer[index]!, outer[next]!, inner[next]!, inner[index]!].map((point) =>
          pushVertex(point.x, y, point.z, n, ...capUv(point)),
        );
        pushTriangle(quad[0]!, quad[1]!, quad[2]!, n);
        pushTriangle(quad[0]!, quad[2]!, quad[3]!, n);
      }
    } else {
      const center = pushVertex(0, y, 0, n, 0.5, 0.5);
      for (let index = 0; index < count; index += 1) {
        const point = outer[index]!;
        const nextPoint = outer[(index + 1) % count]!;
        const a = pushVertex(point.x, y, point.z, n, ...capUv(point));
        const b = pushVertex(nextPoint.x, y, nextPoint.z, n, ...capUv(nextPoint));
        pushTriangle(center, a, b, n);
      }
    }
  }

  // 侧面：outward = 1 为外壁（法线朝外），-1 为内壁（法线朝中心）
  const pushWalls = (loop: readonly Point2D[], outward: 1 | -1) => {
    for (let index = 0; index < count; index += 1) {
      const a = loop[index]!;
      const b = loop[(index + 1) % count]!;
      let normalA: number[];
      let normalB: number[];
      if (smoothSides) {
        const lengthA = Math.hypot(a.x, a.z) || 1;
        const lengthB = Math.hypot(b.x, b.z) || 1;
        normalA = [(outward * a.x) / lengthA, 0, (outward * a.z) / lengthA];
        normalB = [(outward * b.x) / lengthB, 0, (outward * b.z) / lengthB];
      } else {
        // 边的垂线，取离开原点的方向
        let nx = b.z - a.z;
        let nz = -(b.x - a.x);
        const length = Math.hypot(nx, nz) || 1;
        nx /= length;
        nz /= length;
        if (nx * (a.x + b.x) + nz * (a.z + b.z) < 0) {
          nx = -nx;
          nz = -nz;
        }
        normalA = [outward * nx, 0, outward * nz];
        normalB = normalA;
      }
      const u0 = index / count;
      const u1 = (index + 1) / count;
      const bottomA = pushVertex(a.x, -half, a.z, normalA, u0, 0);
      const bottomB = pushVertex(b.x, -half, b.z, normalB, u1, 0);
      const topB = pushVertex(b.x, half, b.z, normalB, u1, 1);
      const topA = pushVertex(a.x, half, a.z, normalA, u0, 1);
      const faceNormal = [
        (normalA[0]! + normalB[0]!) / 2,
        0,
        (normalA[2]! + normalB[2]!) / 2,
      ];
      pushTriangle(bottomA, bottomB, topB, faceNormal);
      pushTriangle(bottomA, topB, topA, faceNormal);
    }
  };
  pushWalls(outer, 1);
  if (inner) pushWalls(inner, -1);

  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  return data;
};

const circleLoop = (radius: number, segments: number): Point2D[] =>
  Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
  });

const rectangleLoop = (width: number, depth: number): Point2D[] => [
  { x: -width / 2, z: -depth / 2 },
  { x: width / 2, z: -depth / 2 },
  { x: width / 2, z: depth / 2 },
  { x: -width / 2, z: depth / 2 },
];

/** 正多边形，第一个顶点在 +Z：边数为 6 时对边朝 ±X */
const regularPolygonLoop = (acrossFlats: number, sides: number): Point2D[] => {
  const radius = acrossFlats / 2 / Math.cos(Math.PI / sides);
  return Array.from({ length: sides }, (_, index) => {
    const angle = Math.PI / 2 + (index / sides) * Math.PI * 2;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
  });
};

/** 自建几何（圆环 / 方环 / 棱柱）的顶点数据；其余形状用 MeshBuilder，返回 null */
export const buildPresetVertexData = (
  descriptor: PresetGeometryDescriptor,
): VertexData | null => {
  switch (descriptor.kind) {
    case "annulus": {
      const { outerDiameter, innerDiameter, height, segments } = descriptor.params;
      return buildExtrudedVertexData({
        outer: circleLoop(outerDiameter / 2, segments),
        inner: innerDiameter > 0 ? circleLoop(innerDiameter / 2, segments) : null,
        height,
        smoothSides: true,
      });
    }
    case "frame": {
      const { outerWidth, outerDepth, innerWidth, innerDepth, height } = descriptor.params;
      return buildExtrudedVertexData({
        outer: rectangleLoop(outerWidth, outerDepth),
        inner: innerWidth > 0 && innerDepth > 0 ? rectangleLoop(innerWidth, innerDepth) : null,
        height,
        smoothSides: false,
      });
    }
    case "prism": {
      const { acrossFlats, height, sides } = descriptor.params;
      return buildExtrudedVertexData({
        outer: regularPolygonLoop(acrossFlats, sides),
        inner: null,
        height,
        smoothSides: false,
      });
    }
    default:
      return null;
  }
};

export const createPresetMesh = (
  shape: PresetShape,
  dims: Dimensions,
  scene: Scene,
  hole?: HoleDimensions,
): Mesh => {
  const descriptor = resolvePresetGeometry(shape, dims, hole);
  switch (descriptor.kind) {
    case "box": {
      const { width, height, depth } = descriptor.params;
      return MeshBuilder.CreateBox("viz3d-preset", { width, height, depth }, scene);
    }
    case "sphere": {
      const { diameter, segments } = descriptor.params;
      return MeshBuilder.CreateSphere("viz3d-preset", { diameter, segments }, scene);
    }
    case "cylinder": {
      const { diameterTop, diameterBottom, height, tessellation } = descriptor.params;
      return MeshBuilder.CreateCylinder(
        "viz3d-preset",
        { diameterTop, diameterBottom, height, tessellation },
        scene,
      );
    }
    case "annulus":
    case "frame":
    case "prism": {
      const mesh = new Mesh("viz3d-preset", scene);
      buildPresetVertexData(descriptor)!.applyToMesh(mesh);
      return mesh;
    }
  }
};
