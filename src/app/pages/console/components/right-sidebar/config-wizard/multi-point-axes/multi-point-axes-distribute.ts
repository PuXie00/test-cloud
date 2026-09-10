import {
  isPointInsideFootprint,
  type Point2D,
  type ShapeFootprint,
} from "./multi-point-axes-geometry";

export const DISTRIBUTE_INSET_SCALE = 0.9;

export type DistributeStrategyId =
  | "rect-corners"
  | "rect-perimeter"
  | "circle-polar"
  | "circle-diameter"
  | "ring-mid"
  | "ring-outer"
  | "sqring-outer-corners"
  | "sqring-midline"
  | "poly-vertices"
  | "poly-perimeter";

export type DistributeStrategyOption = {
  id: DistributeStrategyId;
  label: string;
};

export type DistributeMountsOptions = {
  /** Degrees; 0 = +Z, matching canvas tilt indicator. */
  initialTiltDirection?: number;
};

const EPSILON = 1e-9;

const polarPoint = (radius: number, angleRad: number): Point2D => ({
  x: radius * Math.sin(angleRad),
  z: radius * Math.cos(angleRad),
});

const degToRad = (degrees: number): number => (degrees * Math.PI) / 180;

const rectangleCorners = (halfWidth: number, halfDepth: number): Point2D[] => [
  { x: -halfWidth, z: -halfDepth },
  { x: halfWidth, z: -halfDepth },
  { x: halfWidth, z: halfDepth },
  { x: -halfWidth, z: halfDepth },
];

const rectanglePerimeterLoop = (
  halfWidth: number,
  halfDepth: number,
): Point2D[] => {
  const corners = rectangleCorners(halfWidth, halfDepth);
  return [...corners, corners[0]!];
};

const polygonPerimeterLength = (loop: readonly Point2D[]): number => {
  let length = 0;
  for (let index = 0; index < loop.length - 1; index += 1) {
    const a = loop[index]!;
    const b = loop[index + 1]!;
    length += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return length;
};

/** Sample `count` points along a closed polyline (first==last) by arc length. */
const sampleClosedPolyline = (
  loop: readonly Point2D[],
  count: number,
  startOffsetRatio = 0,
): Point2D[] => {
  if (count <= 0) return [];
  const total = polygonPerimeterLength(loop);
  if (total <= EPSILON) {
    return Array.from({ length: count }, () => ({ ...loop[0]! }));
  }

  const points: Point2D[] = [];
  for (let index = 0; index < count; index += 1) {
    const target =
      (((startOffsetRatio + index / count) % 1) + 1) % 1 * total;
    let walked = 0;
    for (let edge = 0; edge < loop.length - 1; edge += 1) {
      const a = loop[edge]!;
      const b = loop[edge + 1]!;
      const segment = Math.hypot(b.x - a.x, b.z - a.z);
      if (walked + segment >= target - EPSILON || edge === loop.length - 2) {
        const t = segment <= EPSILON ? 0 : (target - walked) / segment;
        const clamped = Math.min(1, Math.max(0, t));
        points.push({
          x: a.x + (b.x - a.x) * clamped,
          z: a.z + (b.z - a.z) * clamped,
        });
        break;
      }
      walked += segment;
    }
  }
  return points;
};

const lerp = (a: Point2D, b: Point2D, t: number): Point2D => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});

/** Corners first; extra points inserted evenly along the four edges (excluding endpoints). */
const distributeRectCorners = (
  halfWidth: number,
  halfDepth: number,
  count: number,
): Point2D[] => {
  const corners = rectangleCorners(halfWidth, halfDepth);
  if (count <= 4) return corners.slice(0, count).map((point) => ({ ...point }));

  const remaining = count - 4;
  const perEdge = Array.from({ length: 4 }, () => 0);
  for (let index = 0; index < remaining; index += 1) {
    perEdge[index % 4]! += 1;
  }

  const result: Point2D[] = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const from = corners[edge]!;
    const to = corners[(edge + 1) % 4]!;
    result.push({ ...from });
    const extras = perEdge[edge]!;
    for (let slot = 1; slot <= extras; slot += 1) {
      result.push(lerp(from, to, slot / (extras + 1)));
    }
  }
  return result;
};

/** Perimeter samples starting at bottom-edge midpoint. */
const distributeRectPerimeter = (
  halfWidth: number,
  halfDepth: number,
  count: number,
): Point2D[] => {
  const loop = rectanglePerimeterLoop(halfWidth, halfDepth);
  const total = polygonPerimeterLength(loop);
  // Bottom edge runs from (-w,-d) to (+w,-d); midpoint is halfway along first edge.
  const bottomEdge = 2 * halfWidth;
  const startOffsetRatio = total <= EPSILON ? 0 : bottomEdge / 2 / total;
  return sampleClosedPolyline(loop, count, startOffsetRatio);
};

const distributeCirclePolar = (
  radius: number,
  count: number,
  initialTiltDirection: number,
): Point2D[] => {
  const start = degToRad(initialTiltDirection);
  return Array.from({ length: count }, (_, index) =>
    polarPoint(radius, start + (index * 2 * Math.PI) / count),
  );
};

const scalePolygon = (points: readonly Point2D[], scale: number): Point2D[] =>
  points.map((point) => ({ x: point.x * scale, z: point.z * scale }));

const evenlyPick = <T,>(items: readonly T[], count: number): T[] => {
  if (count <= 0) return [];
  if (count >= items.length) return [...items];
  return Array.from({ length: count }, (_, index) => {
    const at = Math.round((index * (items.length - 1)) / Math.max(1, count - 1));
    return items[at]!;
  });
};

const distributePolyVertices = (
  vertices: readonly Point2D[],
  count: number,
): Point2D[] => {
  const inset = scalePolygon(vertices, DISTRIBUTE_INSET_SCALE);
  if (count <= inset.length) {
    return evenlyPick(inset, count).map((point) => ({ ...point }));
  }

  const loop = [...inset, inset[0]!];
  const extras = count - inset.length;
  const edgeCounts = Array.from({ length: inset.length }, () => 0);
  for (let index = 0; index < extras; index += 1) {
    edgeCounts[index % inset.length]! += 1;
  }

  const result: Point2D[] = [];
  for (let edge = 0; edge < inset.length; edge += 1) {
    const from = inset[edge]!;
    const to = inset[(edge + 1) % inset.length]!;
    result.push({ ...from });
    const slots = edgeCounts[edge]!;
    for (let slot = 1; slot <= slots; slot += 1) {
      result.push(lerp(from, to, slot / (slots + 1)));
    }
  }
  void loop;
  return result;
};

const distributePolyPerimeter = (
  vertices: readonly Point2D[],
  count: number,
): Point2D[] => {
  const inset = scalePolygon(vertices, DISTRIBUTE_INSET_SCALE);
  const loop = [...inset, inset[0]!];
  return sampleClosedPolyline(loop, count, 0);
};

const strictlyInsideRectangle = (
  point: Point2D,
  halfWidth: number,
  halfDepth: number,
): boolean =>
  Math.abs(point.x) < halfWidth - EPSILON &&
  Math.abs(point.z) < halfDepth - EPSILON;

/** Push a point that fell in the square-ring hole onto the midline rectangle boundary. */
const projectToSquareRingSolid = (
  point: Point2D,
  footprint: Extract<ShapeFootprint, { kind: "squareRing" }>,
): Point2D => {
  if (
    !strictlyInsideRectangle(
      point,
      footprint.innerHalfWidth,
      footprint.innerHalfDepth,
    )
  ) {
    return point;
  }

  const midHalfW =
    (footprint.halfWidth + footprint.innerHalfWidth) / 2;
  const midHalfD =
    (footprint.halfDepth + footprint.innerHalfDepth) / 2;
  if (midHalfW <= EPSILON && midHalfD <= EPSILON) return point;

  const ax = Math.abs(point.x);
  const az = Math.abs(point.z);
  // Scale out to midline rectangle (ray from origin).
  const scaleX = ax <= EPSILON ? Infinity : midHalfW / ax;
  const scaleZ = az <= EPSILON ? Infinity : midHalfD / az;
  const scale = Math.min(scaleX, scaleZ);
  if (!Number.isFinite(scale)) {
    return { x: 0, z: midHalfD };
  }
  return { x: point.x * scale, z: point.z * scale };
};

const ringWorkingRadius = (
  footprint: Extract<ShapeFootprint, { kind: "circle" }>,
  prefer: "mid" | "outer",
): number => {
  const outer = footprint.outerRadius * DISTRIBUTE_INSET_SCALE;
  const inner = footprint.innerRadius ?? 0;
  if (prefer === "outer") {
    return Math.max(outer, inner);
  }
  const mid = (inner + footprint.outerRadius) / 2;
  return Math.min(Math.max(mid, inner), outer);
};

export const listDistributeStrategies = (
  footprint: ShapeFootprint,
): DistributeStrategyOption[] => {
  switch (footprint.kind) {
    case "rectangle":
      return [
        { id: "rect-corners", label: "角点均布" },
        { id: "rect-perimeter", label: "边中点均布" },
      ];
    case "circle":
      if (footprint.innerRadius !== undefined) {
        return [
          { id: "ring-mid", label: "中线圆周" },
          { id: "ring-outer", label: "外圆周均布" },
        ];
      }
      return [
        { id: "circle-polar", label: "圆周均布" },
        { id: "circle-diameter", label: "直径两端" },
      ];
    case "squareRing":
      return [
        { id: "sqring-outer-corners", label: "外角均布" },
        { id: "sqring-midline", label: "环带中线" },
      ];
    case "polygon":
      return [
        { id: "poly-vertices", label: "顶点均布" },
        { id: "poly-perimeter", label: "周长均布" },
      ];
    default:
      return [];
  }
};

export const distributeMounts = (
  footprint: ShapeFootprint,
  strategyId: DistributeStrategyId,
  count: number,
  options: DistributeMountsOptions = {},
): Point2D[] => {
  if (count <= 0) return [];
  const tilt = options.initialTiltDirection ?? 0;

  switch (footprint.kind) {
    case "rectangle": {
      const halfWidth = footprint.halfWidth * DISTRIBUTE_INSET_SCALE;
      const halfDepth = footprint.halfDepth * DISTRIBUTE_INSET_SCALE;
      if (strategyId === "rect-corners") {
        return distributeRectCorners(halfWidth, halfDepth, count);
      }
      if (strategyId === "rect-perimeter") {
        return distributeRectPerimeter(halfWidth, halfDepth, count);
      }
      break;
    }
    case "circle": {
      if (footprint.innerRadius !== undefined) {
        if (strategyId === "ring-mid") {
          return distributeCirclePolar(
            ringWorkingRadius(footprint, "mid"),
            count,
            tilt,
          );
        }
        if (strategyId === "ring-outer") {
          return distributeCirclePolar(
            ringWorkingRadius(footprint, "outer"),
            count,
            tilt,
          );
        }
        break;
      }
      const radius = footprint.outerRadius * DISTRIBUTE_INSET_SCALE;
      if (strategyId === "circle-polar") {
        return distributeCirclePolar(radius, count, tilt);
      }
      if (strategyId === "circle-diameter") {
        if (count === 1) return [polarPoint(radius, degToRad(tilt))];
        if (count === 2) {
          return [
            polarPoint(radius, degToRad(tilt)),
            polarPoint(radius, degToRad(tilt) + Math.PI),
          ];
        }
        return distributeCirclePolar(radius, count, tilt);
      }
      break;
    }
    case "squareRing": {
      if (strategyId === "sqring-outer-corners") {
        const halfWidth = footprint.halfWidth * DISTRIBUTE_INSET_SCALE;
        const halfDepth = footprint.halfDepth * DISTRIBUTE_INSET_SCALE;
        return distributeRectCorners(halfWidth, halfDepth, count).map((point) =>
          projectToSquareRingSolid(point, footprint),
        );
      }
      if (strategyId === "sqring-midline") {
        const midHalfW =
          (footprint.halfWidth + footprint.innerHalfWidth) / 2;
        const midHalfD =
          (footprint.halfDepth + footprint.innerHalfDepth) / 2;
        return distributeRectPerimeter(midHalfW, midHalfD, count);
      }
      break;
    }
    case "polygon": {
      if (strategyId === "poly-vertices") {
        return distributePolyVertices(footprint.points, count);
      }
      if (strategyId === "poly-perimeter") {
        return distributePolyPerimeter(footprint.points, count);
      }
      break;
    }
    default:
      break;
  }

  throw new Error(`Unsupported distribute strategy "${strategyId}" for footprint`);
};

/** Apply mounts onto existing axes in list order (keys preserved). */
export const applyDistributedMounts = <T extends { mount: Point2D }>(
  axes: readonly T[],
  mounts: readonly Point2D[],
): T[] =>
  axes.map((axis, index) => ({
    ...axis,
    mount: mounts[index] ? { ...mounts[index] } : { ...axis.mount },
  }));

export const assertMountsInsideFootprint = (
  mounts: readonly Point2D[],
  footprint: ShapeFootprint,
): boolean => mounts.every((mount) => isPointInsideFootprint(mount, footprint));
