/** 多点摆正解：虚轴姿态 → 各吊点绳长（mm）。对齐 YXZ_2819 `duodian_forward_solution`。 */

export type Vec3 = [number, number, number];

export type MultiPointForwardInput = {
  height: number;
  roll: number;
  pitch: number;
  pointInitPos: readonly Vec3[];
  baseHeight1: number;
  baseHeight2: number;
  maxHeight: number;
  betaInit: number;
};

type Quat = readonly [number, number, number, number];

const DEG_TO_RAD = Math.PI / 180;
const HALF_PI_POW_BASE = 1.5707963;

const toRad = (degrees: number): number => degrees * DEG_TO_RAD;

const rotateByQuat = (x: number, y: number, z: number, quaternion: Quat): Vec3 => {
  const [w, qx, qy, qz] = quaternion;
  const xRot =
    (1 - 2 * qy ** 2 - 2 * qz ** 2) * x +
    (2 * qx * qy - 2 * w * qz) * y +
    (2 * qx * qz + 2 * w * qy) * z;
  const yRot =
    (2 * qx * qy + 2 * w * qz) * x +
    (1 - 2 * qx ** 2 - 2 * qz ** 2) * y +
    (2 * qy * qz - 2 * w * qx) * z;
  const zRot =
    (2 * qx * qz - 2 * w * qy) * x +
    (2 * qy * qz + 2 * w * qx) * y +
    (1 - 2 * qx ** 2 - 2 * qy ** 2) * z;
  return [xRot, yRot, zRot];
};

const niQuatRotateZ = (angleDeg: number): Quat => {
  const half = toRad(angleDeg) / 2;
  return [Math.cos(half), 0, 0, Math.sin(half)];
};

const shunQuatRotateZ = (angleDeg: number): Quat => {
  const half = toRad(angleDeg) / 2;
  return [Math.cos(half), 0, 0, -Math.sin(half)];
};

const shunQuatRotateX = (angleDeg: number): Quat => {
  const half = toRad(angleDeg) / 2;
  return [Math.cos(half), Math.sin(half), 0, 0];
};

const findDistanceFixed = (points: readonly Vec3[], betaDeg: number): number => {
  const beta = -betaDeg * DEG_TO_RAD + Math.PI / 2;
  const rayDirX = -Math.cos(beta);
  const rayDirY = -Math.sin(beta);
  let minDistance = Number.POSITIVE_INFINITY;
  const count = points.length;
  for (let index = 0; index < count; index += 1) {
    const [x1, y1] = points[index]!;
    const [x2, y2] = points[(index + 1) % count]!;
    const abX = x2 - x1;
    const abY = y2 - y1;
    const oaX = -x1;
    const oaY = -y1;
    const denominator = rayDirX * abY - rayDirY * abX;
    if (denominator === 0) continue;
    const t = (oaX * abY - oaY * abX) / denominator;
    const u = (rayDirX * oaY - rayDirY * oaX) / denominator;
    if (t < 0 || u < 0 || u > 1) continue;
    const ix = rayDirX * t;
    const iy = rayDirY * t;
    minDistance = Math.min(minDistance, Math.hypot(ix, iy));
  }
  return Number.isFinite(minDistance) ? minDistance : 0;
};

/** 倾斜时吊点平面沿 (sinβ, cosβ) 的经验横向滑移量（与 initPos 同单位） */
export const multiPointPlanarOffset = (
  initPos: readonly Vec3[],
  betaDeg: number,
  angleDeg: number,
  heightTerm: number,
): number => {
  const offset = findDistanceFixed(initPos, betaDeg);
  if (offset === 0) return 0;
  let powVal = 1.73 + 0.52 * (heightTerm / offset);
  if (powVal > 100) powVal = 100;
  const scale = offset / Math.pow(HALF_PI_POW_BASE, powVal);
  let offsetT = scale * Math.pow(Math.abs(angleDeg * DEG_TO_RAD), powVal);
  if (offsetT > offset) offsetT = offset;
  return offsetT * (angleDeg < 0 ? -1 : 1);
};

const applyPlanarOffset = (
  moved: Vec3[],
  initPos: readonly Vec3[],
  betaDeg: number,
  angleDeg: number,
  heightTerm: number,
): void => {
  const offset = multiPointPlanarOffset(initPos, betaDeg, angleDeg, heightTerm);
  const sinB = Math.sin(toRad(betaDeg));
  const cosB = Math.cos(toRad(betaDeg));
  for (const point of moved) {
    point[0] += sinB * offset;
    point[1] += cosB * offset;
  }
};

const rotateInitPoints = (initPos: readonly Vec3[], betaDeg: number, angleDeg: number): Vec3[] => {
  const nQz = niQuatRotateZ(betaDeg);
  const sQz = shunQuatRotateZ(betaDeg);
  const sQx = shunQuatRotateX(angleDeg);
  return initPos.map((point) => {
    const first = rotateByQuat(point[0], point[1], 0, nQz);
    const second = rotateByQuat(first[0], first[1], first[2], sQx);
    return rotateByQuat(second[0], second[1], second[2], sQz);
  });
};

const signedDistance = (from: Vec3, to: Vec3): number =>
  Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2]);

const solveTopHung = (
  height: number,
  roll: number,
  pitch: number,
  pointInitPos: readonly Vec3[],
  baseHeight1: number,
): number[] => {
  const beta = roll;
  const angle = pitch;
  const moved = rotateInitPoints(pointInitPos, beta, angle);
  applyPlanarOffset(moved, pointInitPos, beta, angle, height + baseHeight1);
  return moved.map((point, index) => {
    const init = pointInitPos[index]!;
    point[2] += init[2] - height - baseHeight1;
    return signedDistance(point, init) - baseHeight1;
  });
};

const solveBottomHung = (
  height: number,
  roll: number,
  pitch: number,
  pointInitPos: readonly Vec3[],
  baseHeight2: number,
  maxHeight: number,
): number[] => {
  const beta = roll;
  const angle = pitch;
  const moved = rotateInitPoints(pointInitPos, beta, angle);
  applyPlanarOffset(moved, pointInitPos, beta, angle, baseHeight2 + maxHeight - height);
  return moved.map((point, index) => {
    const init = pointInitPos[index]!;
    point[2] += init[2] + height - baseHeight2 - maxHeight;
    return baseHeight2 + maxHeight - signedDistance(point, init);
  });
};

export const solveMultiPointForward = (input: MultiPointForwardInput): number[] => {
  const { pointInitPos, baseHeight1, baseHeight2, maxHeight, betaInit } = input;
  if (pointInitPos.length === 0) return [];

  let roll = input.roll + betaInit;
  roll = -roll;
  const pitch = -input.pitch;

  if (baseHeight1 !== 0 && baseHeight2 === 0) {
    return solveTopHung(input.height, roll, pitch, pointInitPos, baseHeight1);
  }
  if (baseHeight1 === 0 && baseHeight2 !== 0) {
    return solveBottomHung(input.height, roll, pitch, pointInitPos, baseHeight2, maxHeight);
  }
  return pointInitPos.map(() => 0);
};

export const roundRopeLengths = (lengths: readonly number[]): number[] =>
  lengths.map((length) => Math.round(length * 100) / 100);
