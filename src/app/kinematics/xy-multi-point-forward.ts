/** XY 多点摆（多点倾斜）正解：虚轴 H/X/Y → 各吊点绳长（mm）。对齐 PLC `YZ_XYDofMotion.dof`。 */
import type { Vec3 } from "./multi-point-forward";

export type XyMultiPointForwardInput = {
  height: number;
  angleX: number;
  angleY: number;
  pointInitPos: readonly Vec3[];
  baseHeight1: number;
  baseHeight2: number;
  maxHeight: number;
};

type PlanePoint = readonly [number, number];

const DEG_TO_RAD = Math.PI / 180;
const HALF_PI_POW_BASE = 1.5707963;
const TILT_EPSILON = 1e-8;
const EDGE_EPSILON = 1e-12;

const clampUnit = (value: number): number => Math.min(1, Math.max(-1, value));

const turn = (a: PlanePoint, b: PlanePoint, c: PlanePoint): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

const monotoneChain = (points: readonly PlanePoint[]): PlanePoint[] => {
  const chain: PlanePoint[] = [];
  for (const point of points) {
    while (chain.length >= 2 && turn(chain[chain.length - 2]!, chain[chain.length - 1]!, point) <= 0) {
      chain.pop();
    }
    chain.push(point);
  }
  return chain;
};

/** 吊点平面凸包；不足 3 个顶点（两吊点或全部共线）时没有凸包，倾斜不产生水平偏移 */
const convexHull = (points: readonly Vec3[]): PlanePoint[] => {
  const unique = new Map<string, PlanePoint>();
  for (const [x, y] of points) unique.set(`${x},${y}`, [x, y]);
  const ordered = [...unique.values()].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const lower = monotoneChain(ordered);
  const upper = monotoneChain([...ordered].reverse());
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return hull.length >= 3 ? hull : [];
};

/** 原点沿 (dirX, dirY) 到凸包边的最近距离；原点不在凸包内时为 0 */
const hullDistance = (hull: readonly PlanePoint[], dirX: number, dirY: number): number => {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < hull.length; index += 1) {
    const [x, y] = hull[index]!;
    const [nextX, nextY] = hull[(index + 1) % hull.length]!;
    if (x * nextY - y * nextX === 0) continue;
    const edgeX = nextX - x;
    const edgeY = nextY - y;
    const denominator = dirX * edgeY - dirY * edgeX;
    if (denominator === 0) continue;
    const radius = (x * edgeY - y * edgeX) / denominator;
    const fraction = (dirY * x - dirX * y) / denominator;
    if (radius > 0 && fraction >= -EDGE_EPSILON && fraction <= 1 + EDGE_EPSILON) {
      minimum = Math.min(minimum, radius);
    }
  }
  return Number.isFinite(minimum) ? minimum : 0;
};

/** 倾斜时吊点平面沿倾斜方向的经验横向滑移量（幂律，不超过凸包边距） */
const planarOffset = (
  hull: readonly PlanePoint[],
  tilt: number,
  beta: number,
  vertical: number,
): number => {
  if (hull.length === 0 || tilt <= TILT_EPSILON) return 0;
  const radius = hullDistance(hull, Math.sin(beta), Math.cos(beta));
  if (!(radius > 0)) return 0;
  const power = Math.min(1.73 + 0.52 * (vertical / radius), 100);
  return radius * Math.min(1, (tilt / HALF_PI_POW_BASE) ** power);
};

export const solveXyMultiPointForward = (input: XyMultiPointForwardInput): number[] => {
  const { pointInitPos, baseHeight1, baseHeight2, maxHeight, height } = input;
  if (pointInitPos.length === 0) return [];
  const topHung = baseHeight1 !== 0 && baseHeight2 === 0;
  const bottomHung = baseHeight1 === 0 && baseHeight2 !== 0;
  if (!topHung && !bottomHung) return pointInitPos.map(() => 0);

  const pitch = -input.angleX * DEG_TO_RAD;
  const roll = -input.angleY * DEG_TO_RAD;
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);
  const sinRoll = Math.sin(roll);
  const cosRoll = Math.cos(roll);

  // 平台法向与竖直方向的夹角；偏移方向从 +Y 量起
  const tilt = Math.acos(clampUnit(cosPitch * cosRoll));
  let beta = 0;
  if (tilt > TILT_EPSILON) {
    beta = Math.acos(clampUnit(sinPitch / Math.sin(tilt)));
    if (-sinRoll * cosPitch < 0) beta = -beta;
  }
  const vertical = topHung ? height + baseHeight1 : baseHeight2 + maxHeight - height;
  const offset = planarOffset(convexHull(pointInitPos), tilt, beta, vertical);
  const offsetX = Math.sin(beta) * offset;
  const offsetY = Math.cos(beta) * offset;

  return pointInitPos.map(([x, y, z]) => {
    // 先绕 X 轴倾斜，再绕固定 Y 轴摆动
    const tiltedY = cosPitch * y - sinPitch * z;
    const tiltedZ = sinPitch * y + cosPitch * z;
    const dx = cosRoll * x + sinRoll * tiltedZ - x + offsetX;
    const dy = tiltedY - y + offsetY;
    const dz = -sinRoll * x + cosRoll * tiltedZ - z - vertical;
    const length = Math.hypot(dx, dy, dz);
    return topHung ? length - baseHeight1 : baseHeight2 + maxHeight - length;
  });
};
