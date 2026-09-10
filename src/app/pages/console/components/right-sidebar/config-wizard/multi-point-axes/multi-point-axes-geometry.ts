import type { AxisDefinition, ControlledObject } from "../config-wizard-types";

export type Point2D = { x: number; z: number };

export type ShapeFootprint =
  | { kind: "rectangle"; halfWidth: number; halfDepth: number; approximate?: boolean }
  | { kind: "circle"; outerRadius: number; innerRadius?: number }
  | {
      kind: "squareRing";
      halfWidth: number;
      halfDepth: number;
      innerHalfWidth: number;
      innerHalfDepth: number;
    }
  | { kind: "polygon"; points: readonly Point2D[] };

export type ModelBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type ClosedAxisEdge = {
  fromKey: string;
  toKey: string;
  from: Point2D;
  to: Point2D;
  distanceMm: number;
  midpoint: Point2D;
};

const EPSILON = 1e-9;

const insideRectangle = (
  point: Point2D,
  halfWidth: number,
  halfDepth: number,
): boolean =>
  Math.abs(point.x) <= halfWidth + EPSILON &&
  Math.abs(point.z) <= halfDepth + EPSILON;

/** Strict interior — boundary is excluded (used for ring/sqRing holes). */
const strictlyInsideRectangle = (
  point: Point2D,
  halfWidth: number,
  halfDepth: number,
): boolean =>
  Math.abs(point.x) < halfWidth - EPSILON &&
  Math.abs(point.z) < halfDepth - EPSILON;

const insideConvexPolygon = (
  point: Point2D,
  vertices: readonly Point2D[],
): boolean => {
  let sign = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index]!;
    const b = vertices[(index + 1) % vertices.length]!;
    const cross = (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
    if (Math.abs(cross) <= EPSILON) continue;
    const nextSign = Math.sign(cross);
    if (sign !== 0 && nextSign !== sign) return false;
    sign = nextSign;
  }
  return true;
};

const insideCircle = (
  point: Point2D,
  outerRadius: number,
  innerRadius?: number,
): boolean => {
  const distance = Math.hypot(point.x, point.z);
  if (distance > outerRadius + EPSILON) return false;
  if (innerRadius !== undefined && distance < innerRadius - EPSILON) return false;
  return true;
};

export const createShapeFootprint = (
  object: Pick<ControlledObject, "shapePreset" | "shapeDimensions" | "dimensions">,
): ShapeFootprint => {
  const { shapePreset, shapeDimensions, dimensions } = object;

  switch (shapePreset) {
    case "cube": {
      const { width, depth } = shapeDimensions as { width: number; depth: number };
      return { kind: "rectangle", halfWidth: width / 2, halfDepth: depth / 2 };
    }
    case "cyl":
    case "sphere": {
      const { diameter } = shapeDimensions as { diameter: number };
      return { kind: "circle", outerRadius: diameter / 2 };
    }
    case "ring": {
      const { outerDiameter, innerDiameter } = shapeDimensions as {
        outerDiameter: number;
        innerDiameter: number;
      };
      return {
        kind: "circle",
        outerRadius: outerDiameter / 2,
        innerRadius: innerDiameter / 2,
      };
    }
    case "sqRing": {
      const { outerWidth, outerDepth, ringWidth } = shapeDimensions as {
        outerWidth: number;
        outerDepth: number;
        ringWidth: number;
      };
      return {
        kind: "squareRing",
        halfWidth: outerWidth / 2,
        halfDepth: outerDepth / 2,
        innerHalfWidth: Math.max(0, outerWidth / 2 - ringWidth),
        innerHalfDepth: Math.max(0, outerDepth / 2 - ringWidth),
      };
    }
    case "prism6": {
      const { acrossFlats } = shapeDimensions as { acrossFlats: number };
      const w = acrossFlats / 2;
      const h = acrossFlats / 2;
      return {
        kind: "polygon",
        points: [
          { x: 0, z: -h },
          { x: w, z: -h / 2 },
          { x: w, z: h / 2 },
          { x: 0, z: h },
          { x: -w, z: h / 2 },
          { x: -w, z: -h / 2 },
        ],
      };
    }
    case "external": {
      const { width, depth } = shapeDimensions as { width: number; depth: number };
      return {
        kind: "rectangle",
        halfWidth: width / 2,
        halfDepth: depth / 2,
        approximate: true,
      };
    }
    default:
      return {
        kind: "rectangle",
        halfWidth: dimensions.w / 2,
        halfDepth: dimensions.d / 2,
        approximate: true,
      };
  }
};

export const isPointInsideFootprint = (
  point: Point2D,
  footprint: ShapeFootprint,
): boolean => {
  switch (footprint.kind) {
    case "rectangle":
      return insideRectangle(point, footprint.halfWidth, footprint.halfDepth);
    case "circle":
      return insideCircle(point, footprint.outerRadius, footprint.innerRadius);
    case "squareRing":
      // Outer/inner boundaries are valid solid; only the strict inner-hole interior is invalid.
      return (
        insideRectangle(point, footprint.halfWidth, footprint.halfDepth) &&
        !strictlyInsideRectangle(
          point,
          footprint.innerHalfWidth,
          footprint.innerHalfDepth,
        )
      );
    case "polygon":
      return insideConvexPolygon(point, footprint.points);
    default:
      return false;
  }
};

export const getFootprintBounds = (footprint: ShapeFootprint): ModelBounds => {
  switch (footprint.kind) {
    case "rectangle":
      return {
        minX: -footprint.halfWidth,
        maxX: footprint.halfWidth,
        minZ: -footprint.halfDepth,
        maxZ: footprint.halfDepth,
      };
    case "circle":
      return {
        minX: -footprint.outerRadius,
        maxX: footprint.outerRadius,
        minZ: -footprint.outerRadius,
        maxZ: footprint.outerRadius,
      };
    case "squareRing":
      return {
        minX: -footprint.halfWidth,
        maxX: footprint.halfWidth,
        minZ: -footprint.halfDepth,
        maxZ: footprint.halfDepth,
      };
    case "polygon": {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const vertex of footprint.points) {
        minX = Math.min(minX, vertex.x);
        maxX = Math.max(maxX, vertex.x);
        minZ = Math.min(minZ, vertex.z);
        maxZ = Math.max(maxZ, vertex.z);
      }
      return { minX, maxX, minZ, maxZ };
    }
    default:
      return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  }
};

const toClosedAxisEdge = (
  from: AxisDefinition,
  to: AxisDefinition,
): ClosedAxisEdge => {
  const dx = to.mount.x - from.mount.x;
  const dz = to.mount.z - from.mount.z;
  return {
    fromKey: from.key,
    toKey: to.key,
    from: from.mount,
    to: to.mount,
    distanceMm: Math.hypot(dx, dz),
    midpoint: {
      x: (from.mount.x + to.mount.x) / 2,
      z: (from.mount.z + to.mount.z) / 2,
    },
  };
};

export const buildClosedAxisEdges = (
  axes: readonly AxisDefinition[],
): ClosedAxisEdge[] => {
  if (axes.length < 2) return [];

  // Two points: one open segment (avoid duplicate A→B / B→A labels).
  if (axes.length === 2) {
    return [toClosedAxisEdge(axes[0]!, axes[1]!)];
  }

  return axes.map((axis, index) =>
    toClosedAxisEdge(axis, axes[(index + 1) % axes.length]!),
  );
};

/** 相邻吊点默认间距，单位 mm */
export const AXIS_MOUNT_STEP_MM = 200;

/** 末尾追加：落在最后一个吊点右侧 */
export const createNextAxisMount = (axes: readonly AxisDefinition[]): Point2D => {
  const last = axes.at(-1);
  return last
    ? { x: last.mount.x + AXIS_MOUNT_STEP_MM, z: last.mount.z }
    : { x: 0, z: 0 };
};

/**
 * 相对锚点插入：
 * - 最前：锚点左侧
 * - 最后：锚点右侧
 * - 中间：前后两点中点
 */
export const createRelativeAxisMount = (
  axes: readonly AxisDefinition[],
  anchorIndex: number,
  position: "before" | "after",
): Point2D => {
  const anchor = axes[anchorIndex];
  if (!anchor) return { x: 0, z: 0 };

  if (position === "before") {
    if (anchorIndex <= 0) {
      return { x: anchor.mount.x - AXIS_MOUNT_STEP_MM, z: anchor.mount.z };
    }
    const previous = axes[anchorIndex - 1]!;
    return {
      x: (previous.mount.x + anchor.mount.x) / 2,
      z: (previous.mount.z + anchor.mount.z) / 2,
    };
  }

  if (anchorIndex >= axes.length - 1) {
    return { x: anchor.mount.x + AXIS_MOUNT_STEP_MM, z: anchor.mount.z };
  }
  const next = axes[anchorIndex + 1]!;
  return {
    x: (anchor.mount.x + next.mount.x) / 2,
    z: (anchor.mount.z + next.mount.z) / 2,
  };
};

const unionBounds = (
  a: ModelBounds,
  b: ModelBounds,
): ModelBounds => ({
  minX: Math.min(a.minX, b.minX),
  maxX: Math.max(a.maxX, b.maxX),
  minZ: Math.min(a.minZ, b.minZ),
  maxZ: Math.max(a.maxZ, b.maxZ),
});

const boundsFromAxisPoints = (axes: readonly AxisDefinition[]): ModelBounds => {
  if (axes.length === 0) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const axis of axes) {
    minX = Math.min(minX, axis.mount.x);
    maxX = Math.max(maxX, axis.mount.x);
    minZ = Math.min(minZ, axis.mount.z);
    maxZ = Math.max(maxZ, axis.mount.z);
  }

  return { minX, maxX, minZ, maxZ };
};

const safetyCircleBounds = (safetyRadiusMm: number): ModelBounds => ({
  minX: -safetyRadiusMm,
  maxX: safetyRadiusMm,
  minZ: -safetyRadiusMm,
  maxZ: safetyRadiusMm,
});

export const createAutoFitBounds = (
  footprint: ShapeFootprint,
  safetyRadiusMm: number,
  axes: readonly AxisDefinition[],
  layoutCircleRadiusMm = 0,
): ModelBounds => {
  let bounds = unionBounds(
    getFootprintBounds(footprint),
    safetyCircleBounds(safetyRadiusMm),
  );
  bounds = unionBounds(bounds, boundsFromAxisPoints(axes));
  if (layoutCircleRadiusMm > 0) {
    bounds = unionBounds(bounds, safetyCircleBounds(layoutCircleRadiusMm));
  }

  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const paddingX = Math.max(100, spanX * 0.1);
  const paddingZ = Math.max(100, spanZ * 0.1);

  bounds = {
    minX: bounds.minX - paddingX,
    maxX: bounds.maxX + paddingX,
    minZ: bounds.minZ - paddingZ,
    maxZ: bounds.maxZ + paddingZ,
  };

  const paddedSpanX = bounds.maxX - bounds.minX;
  const paddedSpanZ = bounds.maxZ - bounds.minZ;
  const minSpan = 1000;

  if (paddedSpanX < minSpan) {
    const centerX = (bounds.minX + bounds.maxX) / 2;
    bounds.minX = centerX - minSpan / 2;
    bounds.maxX = centerX + minSpan / 2;
  }

  if (paddedSpanZ < minSpan) {
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    bounds.minZ = centerZ - minSpan / 2;
    bounds.maxZ = centerZ + minSpan / 2;
  }

  return bounds;
};
