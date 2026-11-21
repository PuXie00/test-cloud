/**
 * 四模型实轴速度核对，对应 python/非强制就近接入.py 里 _SpeedInterval 到 _verify_motor_plan。
 * 表达式顺序跟 Python 一致；sum 用 pythonSum。
 */
import { nextAfter, pythonSum, ulp } from "./algorithm-params";
import type { AxisTrack, EntryMove } from "./nonforced-entry";

const RATE_LIMIT = 6553.5;
const TAU = Math.PI * 2;

/** _device_track：按设备建一条实际轨迹（无极旋转的 H 按周期最短路回放） */
export type TrackFactory = (
  device: MotorHost,
  index: number,
  anchor: number,
  sends: readonly [number, EntryMove][],
) => AxisTrack;

export type MotorEdge = {
  x: number;
  y: number;
  dx: Interval;
  dy: Interval;
  cross: Interval;
  radiusMin: number;
  radiusMax: number;
};

export type MotorGeometry = {
  points: [number, number, number][];
  edges: MotorEdge[];
  base1: number;
  base2: number;
  maxHeight: number;
  beta: number;
};

export type MotorHost = {
  modelId: number;
  /** 无极旋转 H 的 workingStroke；其他模型为 null */
  positionPeriodH: number | null;
  commands: { length: number }[];
  prepareCaps: [number, number, number][];
  current: number[];
  tracks: AxisTrack[];
  motorType: number | null;
  motorLimit: number;
  motorGeometry: MotorGeometry | null;
  motorDomain: [number, number] | null;
  motorGeometrySignature: unknown;
  motorBoxCache?: Map<string, number>;
  motorReferenceSignature?: string;
  motorMotionCertificates?: Map<string, true>;
  motorSharedBoxCache?: Map<string, number>;
};

type MotorMove = { send_u: number; move: EntryMove };

export type MotorEntry = { index: number; moves: MotorMove[] };

export type MotorPlan = {
  u0: number;
  clock_start_u: number;
  lead_ms: number;
  entries: [MotorHost, MotorEntry][];
  motorTimeHintScale?: number;
  motorVerificationCertificate?: [string, [boolean, string]];
};

const finite = (value: unknown, name: string): number => {
  if (typeof value === "boolean" || typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name}须为有限数值`);
  }
  return value;
};

const asFloat = (value: unknown): number => {
  if (typeof value === "boolean" || (typeof value !== "number" && typeof value !== "bigint")) {
    return Number.NaN;
  }
  return Number(value);
};

const pyMod = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;

class Interval {
  lo: number;
  hi: number;

  constructor(lo: number, hi?: number) {
    this.lo = lo;
    this.hi = hi === undefined ? lo : hi;
  }

  static outward(lo: number, hi: number): Interval {
    return new Interval(nextAfter(lo, Number.NEGATIVE_INFINITY), nextAfter(hi, Number.POSITIVE_INFINITY));
  }

  add(other: Interval | number): Interval {
    const right = other instanceof Interval ? other : new Interval(other);
    if (this.lo === this.hi && this.hi === 0) return right;
    if (right.lo === right.hi && right.hi === 0) return this;
    return Interval.outward(this.lo + right.lo, this.hi + right.hi);
  }

  neg(): Interval {
    return new Interval(-this.hi, -this.lo);
  }

  sub(other: Interval | number): Interval {
    return this.add(other instanceof Interval ? other.neg() : -other);
  }

  mul(other: Interval | number): Interval {
    const right = other instanceof Interval ? other : new Interval(other);
    if ((this.lo === this.hi && this.hi === 0) || (right.lo === right.hi && right.hi === 0)) return new Interval(0);
    const values = [this.lo * right.lo, this.lo * right.hi, this.hi * right.lo, this.hi * right.hi];
    return Interval.outward(Math.min(...values), Math.max(...values));
  }

  div(other: Interval | number): Interval {
    const right = other instanceof Interval ? other : new Interval(other);
    if (right.lo <= 0 && right.hi >= 0) throw new Error("速度上界的区间除数包含0");
    if (this.lo === this.hi && this.hi === 0) return new Interval(0);
    const values = [this.lo / right.lo, this.lo / right.hi, this.hi / right.lo, this.hi / right.hi];
    return Interval.outward(Math.min(...values), Math.max(...values));
  }

  square(): Interval {
    const lower = this.lo <= 0 && this.hi >= 0 ? 0 : Math.min(this.lo * this.lo, this.hi * this.hi);
    const upper = Math.max(this.lo * this.lo, this.hi * this.hi);
    const result = Interval.outward(lower, upper);
    result.lo = Math.max(0, result.lo);
    return result;
  }

  sqrt(): Interval {
    const result = Interval.outward(Math.sqrt(Math.max(0, this.lo)), Math.sqrt(Math.max(0, this.hi)));
    result.lo = Math.max(0, result.lo);
    return result;
  }

  maxAbs(): number {
    return Math.max(Math.abs(this.lo), Math.abs(this.hi));
  }

  trig(cosine = false): Interval {
    if (this.hi - this.lo >= TAU || Math.max(Math.abs(this.lo), Math.abs(this.hi)) > 1e6) {
      return new Interval(-1, 1);
    }
    const fn = cosine ? Math.cos : Math.sin;
    const values = [fn(this.lo), fn(this.hi)];
    const first = Math.floor(this.lo / (Math.PI / 2)) - 1;
    const last = Math.ceil(this.hi / (Math.PI / 2)) + 1;
    let piRange = new Interval(Math.PI);
    for (let step = 0; step < 8; step += 1) piRange = Interval.outward(piRange.lo, piRange.hi);
    for (let k = first; k <= last; k += 1) {
      const critical = piRange.mul(k / 2);
      if (critical.lo <= this.hi && critical.hi >= this.lo) {
        const index = pyMod(k, 4);
        values.push(cosine ? [1, 0, -1, 0][index]! : [0, 1, 0, -1][index]!);
      }
    }
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    for (let step = 0; step < 8; step += 1) {
      lo = nextAfter(lo, Number.NEGATIVE_INFINITY);
      hi = nextAfter(hi, Number.POSITIVE_INFINITY);
    }
    return new Interval(Math.max(-1, lo), Math.min(1, hi));
  }
}

const I = (lo: number, hi?: number) => new Interval(lo, hi);

const motorDirectionInterval = (component: Interval, other: Interval): Interval => {
  const minimumOther = other.lo <= 0 && other.hi >= 0 ? 0 : Math.min(Math.abs(other.lo), Math.abs(other.hi));
  const maximumOther = Math.max(Math.abs(other.lo), Math.abs(other.hi));
  const corner = (value: number, perpendicular: number, lower: boolean): number => {
    if (value === 0 && perpendicular === 0) return lower ? -1 : 1;
    const scale = Math.max(Math.abs(value), Math.abs(perpendicular));
    const numerator = I(value).div(scale);
    const denominatorComponent = I(perpendicular).div(scale);
    const distance = numerator.square().add(denominatorComponent.square()).sqrt();
    if (distance.lo === 0) return lower ? -1 : 1;
    const ratio = numerator.div(distance);
    return lower ? Math.max(-1, ratio.lo) : Math.min(1, ratio.hi);
  };
  const lowOther = component.lo >= 0 ? maximumOther : minimumOther;
  const highOther = component.hi <= 0 ? maximumOther : minimumOther;
  return I(corner(component.lo, lowOther, true), corner(component.hi, highOther, false));
};

const convexHull = (points: readonly [number, number][]): [number, number][] => {
  const lower: [number, number][] = [];
  const upper: [number, number][] = [];
  const turn = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (const point of points) {
    while (lower.length >= 2 && turn(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  for (const point of [...points].reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
};

const uniqueSorted = (points: readonly [number, number][]): [number, number][] => {
  const seen = new Set<string>();
  const unique: [number, number][] = [];
  for (const point of points) {
    const key = `${point[0]},${point[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(point);
  }
  unique.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  return unique;
};

const prepareMultiPointGeometry = (model: Record<string, unknown>): MotorGeometry => {
  const rawPoints = model.point_init_pos;
  if (!Array.isArray(rawPoints)) throw new Error("吊点须为有限的[x,y]或[x,y,z]坐标");
  const points: [number, number, number][] = [];
  for (const point of rawPoints) {
    if (!Array.isArray(point) || (point.length !== 2 && point.length !== 3)) {
      throw new Error("吊点须为有限的[x,y]或[x,y,z]坐标");
    }
    const values = point.map((value) => asFloat(value));
    if (values.some((value) => !Number.isFinite(value))) throw new Error("吊点须为有限的[x,y]或[x,y,z]坐标");
    points.push(values.length === 3 ? [values[0]!, values[1]!, values[2]!] : [values[0]!, values[1]!, 0]);
  }
  const xy = model.model_type === 9;
  if (points.length < (xy ? 2 : 3)) throw new Error(xy ? "XY多点摆至少需要2个吊点" : "普通多点摆至少需要3个吊点");
  const twoPointXy = xy && points.length === 2;
  if (twoPointXy) {
    const [[x0, y0, z0], [x1, y1, z1]] = points as [[number, number, number], [number, number, number]];
    const onX = y0 === 0 && y1 === 0 && x0 !== x1 && Math.min(x0, x1) <= 0 && 0 <= Math.max(x0, x1);
    const onY = x0 === 0 && x1 === 0 && y0 !== y1 && Math.min(y0, y1) <= 0 && 0 <= Math.max(y0, y1);
    if (z0 !== 0 || z1 !== 0 || !(onX || onY)) {
      throw new Error("XY双吊点须位于同一X轴或Y轴、线段包含原点、两点不重合且Z=0");
    }
  }
  // PLC ConvexHull 在 pointNum<3 时不生成凸包，XY 双点正解的水平偏移为 0
  const hull = twoPointXy ? [] : convexHull(uniqueSorted(points.map((point) => [point[0], point[1]])));
  if (hull.length < 3 && !twoPointXy) throw new Error("吊点不能全部共线");
  const base1 = asFloat(model.Baseheight1);
  const base2 = asFloat(model.Baseheight2);
  const height = asFloat(model.maxheight);
  const beta = asFloat(model.betainit ?? 0);
  if (![base1, base2, height, beta].every(Number.isFinite)) throw new Error("多点几何参数必须是有限数值");
  if (!((base1 > 0 && base2 === 0) || (base1 === 0 && base2 > 0)) || height <= 0) {
    throw new Error("两项原点距离须一项大于0、另一项为0，最大高度须大于0");
  }
  if (model.model_type === 9 && beta !== 0) throw new Error("XY多点摆betainit必须为0");
  const edges: MotorEdge[] = [];
  const ring = [...hull.slice(1), hull[0]!];
  for (let index = 0; index < hull.length; index += 1) {
    const [x, y] = hull[index]!;
    const q = ring[index]!;
    if (x * q[1] - y * q[0] === 0) continue;
    const cross = I(x).mul(q[1]).sub(I(y).mul(q[0]));
    if (cross.lo <= 0 && cross.hi >= 0) throw new Error("凸包边与原点过近，边距数值精度不足");
    const dx = I(q[0]).sub(x);
    const dy = I(q[1]).sub(y);
    const length = dx.square().add(dy.square()).sqrt();
    const absoluteCross = cross.lo > 0 ? cross : cross.neg();
    const radiusMin = absoluteCross.div(length).lo;
    const radiusMax = Math.max(I(x).square().add(I(y).square()).sqrt().hi, I(q[0]).square().add(I(q[1]).square()).sqrt().hi);
    edges.push({ x, y, dx, dy, cross, radiusMin, radiusMax });
  }
  if (edges.length === 0 && !twoPointXy) throw new Error("当前吊点无法形成有效边距");
  return { points, edges, base1, base2, maxHeight: height, beta };
};

const multiPointMotorSpeedUpper = (q: Interval[], v: Interval[], geometry: MotorGeometry): number => {
  const [h, pitch, yaw] = q as [Interval, Interval, Interval];
  const [vh, vp, vy] = v as [Interval, Interval, Interval];
  const radians = I(Math.PI).div(180);
  const p = pitch.neg().mul(radians);
  const dp = vp.neg().mul(radians);
  const beta = yaw.add(geometry.beta).neg().mul(radians);
  const dbeta = vy.neg().mul(radians);
  const sine = beta.trig();
  const cosine = beta.trig(true);
  const sp = p.trig();
  const cp = p.trig(true);
  const distanceH = geometry.base1 !== 0 ? h.add(geometry.base1) : I(geometry.base2).add(geometry.maxHeight).sub(h);
  const distanceV = geometry.base1 !== 0 ? vh : vh.neg();
  const radial: [Interval, Interval][] = [];
  for (const edge of geometry.edges) {
    const den0 = sine.mul(edge.dy).sub(cosine.mul(edge.dx));
    const sign = edge.cross.lo > 0 ? 1 : -1;
    const positiveCross = sign > 0 ? edge.cross : edge.cross.neg();
    const positiveDen = sign > 0 ? den0 : den0.neg();
    const possibleDen = positiveCross.div(I(edge.radiusMin, edge.radiusMax));
    const lo = Math.max(positiveDen.lo, possibleDen.lo);
    const hi = Math.min(positiveDen.hi, possibleDen.hi);
    if (lo > hi) continue;
    const den = I(lo, hi).mul(sign);
    const u = cosine.mul(edge.x).sub(sine.mul(edge.y)).div(den);
    if (u.hi < 0 || u.lo > 1) continue;
    let radius = edge.cross.div(den);
    radius = I(Math.max(edge.radiusMin, radius.lo), Math.min(edge.radiusMax, radius.hi));
    if (radius.lo > radius.hi) continue;
    const denVelocity = cosine.mul(edge.dy).add(sine.mul(edge.dx)).mul(dbeta);
    const radiusVelocity = radius.square().div(edge.cross).neg().mul(denVelocity);
    radial.push([radius, radiusVelocity]);
  }
  if (radial.length === 0) throw new Error("多点射线未找到边界，请检查吊点坐标及角度数值范围");
  const absP = I(p.lo <= 0 && p.hi >= 0 ? 0 : Math.min(Math.abs(p.lo), Math.abs(p.hi)), p.maxAbs());
  const signP = p.lo < 0 && p.hi > 0 ? I(-1, 1) : I(p.hi <= 0 ? -1 : 1);
  const ratio = absP.div(1.5707963);
  let upper = 0;
  for (const [radius, radiusVelocity] of radial) {
    const exponentRaw = I(1.73).add(distanceH.div(radius).mul(0.52));
    if (exponentRaw.lo <= 1) return Number.POSITIVE_INFINITY;
    const exponent = I(Math.min(100, exponentRaw.lo), Math.min(100, exponentRaw.hi));
    let exponentVelocity = distanceV.div(radius).sub(distanceH.mul(radiusVelocity).div(radius.square())).mul(0.52);
    if (exponentRaw.lo >= 100) exponentVelocity = I(0);
    else if (exponentRaw.hi >= 100) {
      exponentVelocity = I(Math.min(0, exponentVelocity.lo), Math.max(0, exponentVelocity.hi));
    }
    let offset: Interval;
    let offsetVelocity: Interval;
    if (ratio.lo >= 1) {
      offset = signP.mul(radius);
      offsetVelocity = signP.mul(radiusVelocity);
    } else {
      const rho = I(Math.max(0, ratio.lo), Math.min(1, ratio.hi));
      const powerRange = (n: Interval): Interval => {
        let result = Interval.outward(rho.lo ** n.hi, rho.hi ** n.lo);
        for (let step = 0; step < 7; step += 1) result = Interval.outward(result.lo, result.hi);
        return I(Math.max(0, result.lo), Math.min(1, result.hi));
      };
      const weight = powerRange(exponent);
      const slopeWeight = powerRange(exponent.sub(I(1)));
      const nMin = exponent.lo;
      const logWeight = (r: number) => (r === 0 ? 0 : -(r ** nMin) * Math.log(r));
      let logMax = Math.max(logWeight(rho.lo), logWeight(rho.hi));
      if (rho.lo <= Math.exp(-1 / nMin) && Math.exp(-1 / nMin) <= rho.hi) logMax = Math.max(logMax, 1 / (Math.E * nMin));
      for (let step = 0; step < 16; step += 1) logMax = nextAfter(logMax, Number.POSITIVE_INFINITY);
      let logMin = Math.min(
        ...[rho.lo, rho.hi].map((r) => (r === 0 ? 0 : -(r ** exponent.hi) * Math.log(r))),
      );
      for (let step = 0; step < 16; step += 1) logMin = nextAfter(logMin, Number.NEGATIVE_INFINITY);
      const weightLog = I(-logMax, -Math.max(0, logMin));
      offset = signP.mul(radius).mul(weight);
      offsetVelocity = signP
        .mul(radiusVelocity.mul(weight).add(radius.mul(weightLog).mul(exponentVelocity)))
        .add(radius.mul(exponent).mul(slopeWeight).mul(dp.div(1.5707963)));
      if (ratio.hi >= 1) {
        const saturated = signP.mul(radiusVelocity);
        offsetVelocity = I(Math.min(offsetVelocity.lo, saturated.lo), Math.max(offsetVelocity.hi, saturated.hi));
      }
    }
    for (const point of geometry.points) {
      const [x, y] = point;
      const t = sine.mul(x).add(cosine.mul(y));
      const dt = cosine.mul(x).sub(sine.mul(y)).mul(dbeta);
      const horizontal = cp.sub(I(1)).mul(t).add(offset);
      const horizontalV = sp.neg().mul(dp).mul(t).add(cp.sub(I(1)).mul(dt)).add(offsetVelocity);
      const vertical = sp.mul(t).sub(distanceH);
      const verticalV = cp.mul(dp).mul(t).add(sp.mul(dt)).sub(distanceV);
      let projected: Interval;
      if (vertical.lo > 0 || vertical.hi < 0) {
        const directionRatio = horizontal.div(vertical);
        projected = verticalV.add(directionRatio.mul(horizontalV)).div(I(1).add(directionRatio.square()).sqrt());
      } else {
        projected = motorDirectionInterval(horizontal, vertical)
          .mul(horizontalV)
          .add(motorDirectionInterval(vertical, horizontal).mul(verticalV));
      }
      let normUpper = Math.hypot(horizontalV.maxAbs(), verticalV.maxAbs());
      for (let step = 0; step < 4; step += 1) normUpper = nextAfter(normUpper, Number.POSITIVE_INFINITY);
      upper = Math.max(upper, Math.min(projected.maxAbs(), normUpper));
    }
  }
  if (!Number.isFinite(upper)) throw new Error("多点速度区间计算溢出，请检查原轨迹和几何参数");
  return nextAfter(upper, Number.POSITIVE_INFINITY);
};

const multiPointInstantaneousSpeed = (q: number[], v: number[], geometry: MotorGeometry): number => {
  const [h, pitch, yaw] = q as [number, number, number];
  const [vh, vp, vy] = v as [number, number, number];
  const p = (-pitch * Math.PI) / 180;
  const dp = (-vp * Math.PI) / 180;
  const beta = (-(yaw + geometry.beta) * Math.PI) / 180;
  const dbeta = (-vy * Math.PI) / 180;
  const sine = Math.sin(beta);
  const cosine = Math.cos(beta);
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  const height = geometry.base1 !== 0 ? h + geometry.base1 : geometry.base2 + geometry.maxHeight - h;
  const heightV = geometry.base1 !== 0 ? vh : -vh;
  const candidates: [number, number][] = [];
  for (const edge of geometry.edges) {
    const dx = (edge.dx.lo + edge.dx.hi) * 0.5;
    const dy = (edge.dy.lo + edge.dy.hi) * 0.5;
    const den = sine * dy - cosine * dx;
    if (den === 0) continue;
    const radius = (edge.x * dy - edge.y * dx) / den;
    const u = (cosine * edge.x - sine * edge.y) / den;
    if (radius > 0 && -1e-12 <= u && u <= 1 + 1e-12) {
      candidates.push([radius, (-radius * (cosine * dy + sine * dx) * dbeta) / den]);
    }
  }
  if (candidates.length === 0) {
    return multiPointMotorSpeedUpper(q.map((value) => I(value)), v.map((value) => I(value)), geometry);
  }
  const minimum = Math.min(...candidates.map(([radius]) => radius));
  let upper = 0;
  for (const [radius, radiusV] of candidates) {
    if (radius > minimum * (1 + 1e-10)) continue;
    const nRaw = 1.73 + (0.52 * height) / radius;
    if (nRaw <= 1) throw new Error("多点偏移幂需大于1，当前原轨迹可能在P=0处不可导，请检查参考高度");
    const n = Math.min(100, nRaw);
    const nV = nRaw >= 100 ? 0 : 0.52 * (heightV / radius - (height * radiusV) / radius ** 2);
    const rho = Math.abs(p) / 1.5707963;
    const sign = p < 0 ? -1 : 1;
    let offset = 0;
    let offsetV = 0;
    if (rho >= 1) {
      offset = sign * radius;
      offsetV = sign * radiusV;
    } else if (rho !== 0) {
      const weight = rho ** n;
      offset = sign * radius * weight;
      offsetV =
        sign * (radiusV * weight + radius * weight * Math.log(rho) * nV) +
        (radius * n * rho ** (n - 1) * dp) / 1.5707963;
    }
    for (const [x, y] of geometry.points) {
      const t = sine * x + cosine * y;
      const dt = (cosine * x - sine * y) * dbeta;
      const horizontal = (cp - 1) * t + offset;
      const horizontalV = -sp * dp * t + (cp - 1) * dt + offsetV;
      const vertical = sp * t - height;
      const verticalV = cp * dp * t + sp * dt - heightV;
      const length = Math.hypot(horizontal, vertical);
      const speed =
        length === 0
          ? Math.hypot(horizontalV, verticalV)
          : Math.abs((horizontal / length) * horizontalV + (vertical / length) * verticalV);
      upper = Math.max(upper, speed);
    }
  }
  if (!Number.isFinite(upper)) throw new Error("多点瞬时速度计算溢出");
  return upper;
};

const xyRadiusCandidates = (
  directionX: number,
  directionY: number,
  betaVelocity: number,
  geometry: MotorGeometry,
): [number, number][] => {
  const candidates: [number, number][] = [];
  for (const edge of geometry.edges) {
    const edgeX = (edge.dx.lo + edge.dx.hi) / 2;
    const edgeY = (edge.dy.lo + edge.dy.hi) / 2;
    const denominator = directionX * edgeY - directionY * edgeX;
    if (denominator === 0) continue;
    const radius = (edge.x * edgeY - edge.y * edgeX) / denominator;
    const edgeFraction = (directionY * edge.x - directionX * edge.y) / denominator;
    if (radius > 0 && -1e-12 <= edgeFraction && edgeFraction <= 1 + 1e-12) {
      const denominatorVelocity = (directionY * edgeY + directionX * edgeX) * betaVelocity;
      candidates.push([radius, (-radius * denominatorVelocity) / denominator]);
    }
  }
  if (candidates.length === 0) throw new Error("XY倾斜方向无法求得有效凸包边距，请检查吊点与原点");
  const minimum = Math.min(...candidates.map(([radius]) => radius));
  return candidates.filter(([radius]) => radius <= minimum * (1 + 1e-10));
};

const xyPowerInterval = (ratio: Interval, power: Interval): Interval => {
  const values = [ratio.lo, ratio.hi].flatMap((value) => [value ** power.lo, value ** power.hi]);
  let result = Interval.outward(Math.min(...values), Math.max(...values));
  for (let step = 0; step < 7; step += 1) result = Interval.outward(result.lo, result.hi);
  return I(Math.max(0, result.lo), Math.min(1, result.hi));
};

const xyOffsetBounds = (
  q: Interval[],
  v: Interval[],
  geometry: MotorGeometry,
  sp: Interval,
  cp: Interval,
  sr: Interval,
  cr: Interval,
  dp: Interval,
  dr: Interval,
): [Interval, Interval, Interval, Interval] | null => {
  if (geometry.beta !== 0) throw new Error("XY多点摆betainit必须为0");
  if (geometry.edges.length === 0) return [I(0), I(0), I(0), I(0)];
  const h = q[0]!;
  const vh = v[0]!;
  const vertical = geometry.base1 > 0 ? h.add(geometry.base1) : I(geometry.base2).add(geometry.maxHeight).sub(h);
  const verticalV = geometry.base1 > 0 ? vh : vh.neg();
  const nx = sr.neg().mul(cp);
  const ny = sp;
  const nxV = cr.neg().mul(dr).mul(cp).add(sr.mul(sp).mul(dp));
  const nyV = cp.mul(dp);
  const sine = nx.square().add(ny.square()).sqrt();
  const cosine = cp.mul(cr);
  const tilt = I(
    Math.acos(Math.min(1, Math.max(0, cosine.hi))),
    Math.acos(Math.min(1, Math.max(0, cosine.lo))),
  );
  if (sine.lo <= 0) {
    const rmin = Math.min(...geometry.edges.map((edge) => edge.radiusMin));
    const rmax = Math.max(...geometry.edges.map((edge) => edge.radiusMax));
    let radiusSlope = 0;
    for (const edge of geometry.edges) {
      const crossAbs = Math.min(Math.abs(edge.cross.lo), Math.abs(edge.cross.hi));
      const slope = (edge.radiusMax ** 2 * Math.hypot(edge.dx.maxAbs(), edge.dy.maxAbs())) / crossAbs;
      radiusSlope = Math.max(radiusSlope, slope);
    }
    const rawPower = I(1.73).add(vertical.div(I(rmin, rmax)).mul(0.52));
    if (rawPower.lo <= 1 || cosine.lo <= 0) return null;
    const lowPower = Math.min(100, rawPower.lo);
    const highPower = Math.min(100, rawPower.hi);
    const rho = Math.min(1, tilt.hi / 1.5707963);
    const derivativeNorm = Math.hypot(nxV.maxAbs(), nyV.maxAbs());
    const weight = rho ** lowPower;
    const slopeWeight = rho ** (lowPower - 1);
    const directionScale = Math.PI / (2 * 1.5707963);
    const maxLogWeight = (exponent: number) => {
      if (rho === 0) return 0;
      const values = [-(rho ** exponent) * Math.log(rho)];
      if (Math.exp(-1 / exponent) <= rho) values.push(1 / (Math.E * exponent));
      return Math.max(...values);
    };
    const weightLog = maxLogWeight(lowPower);
    let offsetMax = rmax * weight;
    let speedMax =
      (radiusSlope + rmax) * derivativeNorm * directionScale * slopeWeight +
      0.52 * verticalV.maxAbs() * weightLog +
      ((0.52 * vertical.maxAbs() * radiusSlope) / rmin) * derivativeNorm * directionScale * maxLogWeight(lowPower - 1) +
      (rmax * highPower * slopeWeight * derivativeNorm) / (cosine.lo * 1.5707963);
    for (let step = 0; step < 32; step += 1) {
      offsetMax = nextAfter(offsetMax, Number.POSITIVE_INFINITY);
      speedMax = nextAfter(speedMax, Number.POSITIVE_INFINITY);
    }
    return [I(-offsetMax, offsetMax), I(-offsetMax, offsetMax), I(-speedMax, speedMax), I(-speedMax, speedMax)];
  }
  const dx = nx.div(sine);
  const dy = ny.div(sine);
  const betaV = ny.mul(nxV).sub(nx.mul(nyV)).div(sine.square());
  const tiltV = sp.mul(cr).mul(dp).add(cp.mul(sr).mul(dr)).div(sine);
  const candidates: [Interval, Interval, Interval, Interval][] = [];
  for (const edge of geometry.edges) {
    const denominator0 = dx.mul(edge.dy).sub(dy.mul(edge.dx));
    const sign = edge.cross.lo > 0 ? 1 : -1;
    const positiveCross = sign > 0 ? edge.cross : edge.cross.neg();
    const positiveDen = sign > 0 ? denominator0 : denominator0.neg();
    const possibleDen = positiveCross.div(I(edge.radiusMin, edge.radiusMax));
    const lo = Math.max(positiveDen.lo, possibleDen.lo);
    const hi = Math.min(positiveDen.hi, possibleDen.hi);
    if (lo > hi) continue;
    const denominator = I(lo, hi).mul(sign);
    const edgeFraction = dy.mul(edge.x).sub(dx.mul(edge.y)).div(denominator);
    if (edgeFraction.hi < 0 || edgeFraction.lo > 1) continue;
    let radius = edge.cross.div(denominator);
    radius = I(Math.max(edge.radiusMin, radius.lo), Math.min(edge.radiusMax, radius.hi));
    if (radius.lo > radius.hi) continue;
    const radiusV = radius.square().div(edge.cross).neg().mul(dy.mul(edge.dy).add(dx.mul(edge.dx)).mul(betaV));
    const rawPower = I(1.73).add(vertical.div(radius).mul(0.52));
    if (rawPower.lo <= 1) return null;
    const power = I(Math.min(100, rawPower.lo), Math.min(100, rawPower.hi));
    let powerV = verticalV.div(radius).sub(vertical.mul(radiusV).div(radius.square())).mul(0.52);
    if (rawPower.lo >= 100) powerV = I(0);
    else if (rawPower.hi >= 100) powerV = I(Math.min(0, powerV.lo), Math.max(0, powerV.hi));
    const ratio = tilt.div(1.5707963);
    let offset: Interval;
    let offsetV: Interval;
    if (ratio.lo >= 1) {
      offset = radius;
      offsetV = radiusV;
    } else {
      const rho = I(Math.max(0, ratio.lo), Math.min(1, ratio.hi));
      const weight = xyPowerInterval(rho, power);
      const slopeWeight = xyPowerInterval(rho, power.sub(I(1)));
      const logWeight = (value: number) => (value === 0 ? 0 : -(value ** power.lo) * Math.log(value));
      let logMax = Math.max(logWeight(rho.lo), logWeight(rho.hi));
      if (rho.lo <= Math.exp(-1 / power.lo) && Math.exp(-1 / power.lo) <= rho.hi) {
        logMax = Math.max(logMax, 1 / (Math.E * power.lo));
      }
      for (let step = 0; step < 16; step += 1) logMax = nextAfter(logMax, Number.POSITIVE_INFINITY);
      const weightLog = I(-logMax, 0);
      offset = radius.mul(weight);
      offsetV = radiusV.mul(weight).add(radius.mul(weightLog).mul(powerV)).add(radius.mul(power).mul(slopeWeight).mul(tiltV.div(1.5707963)));
      if (ratio.hi >= 1) offsetV = I(Math.min(offsetV.lo, radiusV.lo), Math.max(offsetV.hi, radiusV.hi));
    }
    candidates.push([
      dx.mul(offset),
      dy.mul(offset),
      dy.mul(betaV).mul(offset).add(dx.mul(offsetV)),
      dx.neg().mul(betaV).mul(offset).add(dy.mul(offsetV)),
    ]);
  }
  if (candidates.length === 0) throw new Error("XY倾斜方向无法求得有效凸包边距");
  if (tilt.lo <= 1e-8) candidates.push([I(0), I(0), I(0), I(0)]);
  return [0, 1, 2, 3].map(
    (index) => I(Math.min(...candidates.map((row) => row[index]!.lo)), Math.max(...candidates.map((row) => row[index]!.hi))),
  ) as [Interval, Interval, Interval, Interval];
};

const xyMotorSpeedUpper = (q: Interval[], v: Interval[], geometry: MotorGeometry): number => {
  const radians = I(Math.PI).div(180);
  const p = q[1]!.neg().mul(radians);
  const r = q[2]!.neg().mul(radians);
  const dp = v[1]!.neg().mul(radians);
  const dr = v[2]!.neg().mul(radians);
  if (p.lo <= -Math.PI / 2 || p.hi >= Math.PI / 2 || r.lo <= -Math.PI / 2 || r.hi >= Math.PI / 2) {
    return Number.POSITIVE_INFINITY;
  }
  const sp = p.trig();
  const cp = p.trig(true);
  const sr = r.trig();
  const cr = r.trig(true);
  const offset = xyOffsetBounds(q, v, geometry, sp, cp, sr, cr, dp, dr);
  if (offset === null) return Number.POSITIVE_INFINITY;
  const [ox, oy, vox, voy] = offset;
  const vertical = geometry.base1 > 0 ? q[0]!.add(geometry.base1) : I(geometry.base2).add(geometry.maxHeight).sub(q[0]!);
  const verticalV = geometry.base1 > 0 ? v[0]! : v[0]!.neg();
  let upper = 0;
  for (const [x, y, z] of geometry.points) {
    const y1 = cp.mul(y).sub(sp.mul(z));
    const z1 = sp.mul(y).add(cp.mul(z));
    const rx = cr.mul(x).add(sr.mul(z1)).sub(x).add(ox);
    const ry = y1.sub(y).add(oy);
    const rz = sr.neg().mul(x).add(cr.mul(z1)).sub(z).sub(vertical);
    const vx = sr.neg().mul(x).add(cr.mul(z1)).mul(dr).add(sr.mul(y1).mul(dp)).add(vox);
    const vy = z1.neg().mul(dp).add(voy);
    const vz = cr.neg().mul(x).sub(sr.mul(z1)).mul(dr).add(cr.mul(y1).mul(dp)).sub(verticalV);
    const horizontal = rx.square().add(ry.square()).sqrt();
    const projected = motorDirectionInterval(rx, ry.square().add(rz.square()).sqrt())
      .mul(vx)
      .add(motorDirectionInterval(ry, rx.square().add(rz.square()).sqrt()).mul(vy))
      .add(motorDirectionInterval(rz, horizontal).mul(vz));
    let norm = Math.sqrt(vx.maxAbs() ** 2 + vy.maxAbs() ** 2 + vz.maxAbs() ** 2);
    for (let step = 0; step < 8; step += 1) norm = nextAfter(norm, Number.POSITIVE_INFINITY);
    upper = Math.max(upper, Math.min(projected.maxAbs(), norm));
  }
  if (!Number.isFinite(upper)) throw new Error("XY速度区间计算溢出");
  return nextAfter(upper, Number.POSITIVE_INFINITY);
};

const xyInstantaneousSpeed = (q: number[], v: number[], geometry: MotorGeometry): number => {
  if (geometry.beta !== 0) throw new Error("XY多点摆betainit必须为0");
  const [height, angleX, angleY] = q as [number, number, number];
  const [velocityH, velocityX, velocityY] = v as [number, number, number];
  if (Math.abs(angleX) >= 90 || Math.abs(angleY) >= 90) throw new Error("XY多点摆X/Y角须在(-90,90)内");
  const radians = Math.PI / 180;
  const pitch = -angleX * radians;
  const roll = -angleY * radians;
  const pitchV = -velocityX * radians;
  const rollV = -velocityY * radians;
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const tilt = Math.acos(Math.max(-1, Math.min(1, cp * cr)));
  const vertical = geometry.base1 > 0 ? height + geometry.base1 : geometry.base2 + geometry.maxHeight - height;
  const verticalV = geometry.base1 > 0 ? velocityH : -velocityH;
  let offsets: [number, number, number, number][] = [[0, 0, 0, 0]];
  if (tilt > 1e-8 && geometry.edges.length > 0) {
    let beta = Math.acos(Math.max(-1, Math.min(1, sp / Math.sin(tilt))));
    if (-sr * cp < 0) beta = -beta;
    const dx = Math.sin(beta);
    const dy = Math.cos(beta);
    const nx = -sr * cp;
    const ny = sp;
    const nxV = -cr * rollV * cp + sr * sp * pitchV;
    const nyV = cp * pitchV;
    const sineSquared = nx * nx + ny * ny;
    const betaV = (ny * nxV - nx * nyV) / sineSquared;
    const tiltV = (sp * cr * pitchV + cp * sr * rollV) / Math.sqrt(sineSquared);
    offsets = [];
    for (const [radius, radiusV] of xyRadiusCandidates(dx, dy, betaV, geometry)) {
      const rawPower = 1.73 + (0.52 * vertical) / radius;
      const power = Math.min(100, rawPower);
      const powerV = rawPower >= 100 ? 0 : 0.52 * (verticalV / radius - (vertical * radiusV) / radius ** 2);
      const ratio = tilt / 1.5707963;
      const weight = ratio ** power;
      let offset: number;
      let offsetV: number;
      if (weight >= 1) {
        offset = radius;
        offsetV = radiusV;
      } else {
        offset = radius * weight;
        offsetV =
          radiusV * weight +
          radius * weight * Math.log(ratio) * powerV +
          (radius * power * ratio ** (power - 1) * tiltV) / 1.5707963;
      }
      offsets.push([
        dx * offset,
        dy * offset,
        dy * betaV * offset + dx * offsetV,
        -dx * betaV * offset + dy * offsetV,
      ]);
    }
  }
  let maximum = 0;
  for (const [offsetX, offsetY, offsetXv, offsetYv] of offsets) {
    for (const [x, y, z] of geometry.points) {
      const y1 = cp * y - sp * z;
      const z1 = sp * y + cp * z;
      const relative = [cr * x + sr * z1 - x + offsetX, y1 - y + offsetY, -sr * x + cr * z1 - z - vertical];
      const velocity = [
        (-sr * x + cr * z1) * rollV + sr * y1 * pitchV + offsetXv,
        -z1 * pitchV + offsetYv,
        (-cr * x - sr * z1) * rollV + cr * y1 * pitchV - verticalV,
      ];
      const length = Math.sqrt(pythonSum(relative.map((value) => value * value)));
      const speed =
        length === 0
          ? Math.sqrt(pythonSum(velocity.map((value) => value * value)))
          : Math.abs(pythonSum(relative.map((value, index) => (value / length) * velocity[index]!)));
      maximum = Math.max(maximum, speed);
    }
  }
  if (!Number.isFinite(maximum)) throw new Error("XY多点摆瞬时速度计算溢出");
  return maximum;
};

const prepareDirectionDomain = (geometry: MotorGeometry): [number, number] | null => {
  if (geometry.edges.length === 0) return null;
  const points = uniqueSorted(geometry.points.map((point) => [point[0], point[1]]));
  const hull = convexHull(points);
  const closed = [...hull.slice(1), hull[0]!];
  if (
    hull.every((point, index) => {
      const q = closed[index]!;
      return I(point[0]).mul(q[1]).sub(I(point[1]).mul(q[0])).lo > 0;
    })
  ) {
    return null;
  }
  const angles = hull
    .filter(([x, y]) => x !== 0 || y !== 0)
    .map(([x, y]) => pyMod(Math.atan2(x, y), TAU))
    .sort((left, right) => left - right);
  const gaps = angles.map((angle, index) => pyMod(angles[(index + 1) % angles.length]! - angle, TAU));
  let gapIndex = 0;
  gaps.forEach((gap, index) => {
    if (gap > gaps[gapIndex]!) gapIndex = index;
  });
  const start = angles[(gapIndex + 1) % angles.length]!;
  const width = TAU - gaps[gapIndex]!;
  if (width > Math.PI) throw new Error("吊点原点接近凸包边界，准备方向域数值精度不足");
  return [start, start + width];
};

const floorRate = (value: number, quantized: boolean): number => {
  const capped = Math.min(value, RATE_LIMIT);
  return quantized ? Math.floor(capped * 10 + 1e-8) / 10 : capped;
};

const sameValue = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/** 单点、多级升降、无极旋转：实轴直接跟随 H，电机速度就是 H 速度 */
const singleAxisMotor = (kind: number | null): boolean => kind === 2 || kind === 3 || kind === 4;

export const configureMotorGeometry = (
  device: MotorHost,
  model: Record<string, unknown>,
  quantize: boolean,
): void => {
  const kind = model.model_type;
  device.motorType = typeof kind === "number" ? kind : kind === undefined ? null : (kind as number);
  device.motorGeometry = null;
  device.motorDomain = null;
  if (kind === undefined || kind === null) {
    device.motorType = null;
    return;
  }
  if (typeof kind !== "number" || !Number.isInteger(kind) || ![2, 3, 4, 7, 9].includes(kind)) {
    throw new Error("model_type只支持2单点、3多级升降、4旋转、7多点摆、9XY多点摆");
  }
  device.motorLimit = finite(model.max_motor_velocity, "max_motor_velocity");
  if (device.motorLimit <= 0) throw new Error("max_motor_velocity须大于0");
  if (singleAxisMotor(kind)) {
    if (device.commands[1]!.length > 0 || device.commands[2]!.length > 0) {
      throw new Error("单点/多级升降/旋转仅支持H轴动作曲线");
    }
    const [velocity, acceleration, deceleration] = device.prepareCaps[0]!;
    const limit = Math.min(velocity, device.motorLimit);
    device.prepareCaps[0] = [floorRate(limit, quantize), acceleration, deceleration];
    return;
  }
  const nested = model.geometry === undefined ? {} : model.geometry;
  if (nested === null || typeof nested !== "object" || Array.isArray(nested)) throw new Error("geometry须为对象");
  const geometryRecord = nested as Record<string, unknown>;
  const fields = ["Baseheight1", "Baseheight2", "maxheight", "betainit", "point_init_pos", "motor_num"] as const;
  const configuration: Record<string, unknown> = { model_type: kind };
  for (const name of fields) {
    if (name in model && name in geometryRecord && !sameValue(model[name], geometryRecord[name])) {
      throw new Error(`${name}平铺字段与geometry配置冲突`);
    }
    const value = name in geometryRecord ? geometryRecord[name] : name in model ? model[name] : name === "betainit" ? 0 : undefined;
    if (name !== "point_init_pos" && name !== "motor_num") configuration[name] = finite(value, name);
    else configuration[name] = value;
  }
  const points = configuration.point_init_pos;
  if (!Array.isArray(points)) throw new Error("point_init_pos须为吊点列表");
  const coordinates: number[][] = [];
  for (const point of points) {
    if (!Array.isArray(point) || (point.length !== 2 && point.length !== 3)) throw new Error("吊点须为[x,y]或[x,y,z]");
    coordinates.push(point.map((value) => finite(value, "吊点坐标")));
  }
  const count = configuration.motor_num;
  if (count !== undefined && count !== null && (typeof count !== "number" || !Number.isInteger(count) || count !== coordinates.length)) {
    throw new Error("motor_num须等于原吊点数量");
  }
  const geometry = prepareMultiPointGeometry(configuration);
  device.motorGeometry = geometry;
  device.motorDomain = prepareDirectionDomain(geometry);
  device.motorGeometrySignature = [kind, geometry.points, geometry.base1, geometry.base2, geometry.maxHeight, geometry.beta];
};

const directionBoxValid = (device: MotorHost, positions: Interval[]): boolean => {
  const domain = device.motorDomain;
  if (domain === null) return true;
  const geometry = device.motorGeometry!;
  if (device.motorType === 7 && positions[1]!.lo === 0 && positions[1]!.hi === 0) return true;
  const [left, right] = domain;
  const radians = Math.PI / 180;
  if (device.motorType === 7) {
    const yaw = positions[2]!;
    const first = -(yaw.hi + geometry.beta) * radians;
    const last = -(yaw.lo + geometry.beta) * radians;
    const shift = Math.floor((first - left) / TAU);
    return [shift - 1, shift, shift + 1].some(
      (turn) => first >= left + turn * TAU - 1e-12 && last <= right + turn * TAU + 1e-12,
    );
  }
  const pitch = positions[1]!.neg().mul(radians);
  const roll = positions[2]!.neg().mul(radians);
  const largestPitch = Math.max(Math.abs(pitch.lo), Math.abs(pitch.hi));
  const largestRoll = Math.max(Math.abs(roll.lo), Math.abs(roll.hi));
  if (Math.acos(Math.min(1, Math.cos(largestPitch) * Math.cos(largestRoll))) <= 1e-8) return true;
  const nx = roll.neg().trig().mul(pitch.trig(true));
  const ny = pitch.trig();
  const crossLeft = I(left).trig().mul(ny).sub(I(left).trig(true).mul(nx));
  const crossRight = nx.mul(I(right).trig(true)).sub(ny.mul(I(right).trig()));
  const tolerance = 1e-12 * Math.hypot(nx.maxAbs(), ny.maxAbs());
  return crossLeft.hi <= tolerance && crossRight.hi <= tolerance;
};

const motorStateSpeed = (device: MotorHost, position: number[], velocity: number[]): number => {
  if (singleAxisMotor(device.motorType)) return Math.abs(velocity[0]!);
  const geometry = device.motorGeometry!;
  if (device.motorType === 7) {
    if (position[1] === 0) {
      const beta = -((position[2]! + geometry.beta) * Math.PI) / 180;
      const sine = Math.sin(beta);
      const cosine = Math.cos(beta);
      const heightVelocity = geometry.base1 > 0 ? velocity[0]! : -velocity[0]!;
      return Math.max(
        ...geometry.points.map(([x, y]) => Math.abs((-Math.PI / 180) * velocity[1]! * (sine * x + cosine * y) - heightVelocity)),
      );
    }
    return multiPointInstantaneousSpeed(position, velocity, geometry);
  }
  return xyInstantaneousSpeed(position, velocity, geometry);
};

const keyOf = (value: unknown): string => JSON.stringify(value);

const motorSpeedBoxUpper = (device: MotorHost, positions: Interval[], velocities: Interval[]): number => {
  if (singleAxisMotor(device.motorType)) return velocities[0]!.maxAbs();
  const key = keyOf([
    device.motorGeometrySignature,
    [...positions, ...velocities].map((value) => [value.lo, value.hi]),
  ]);
  const cache = device.motorBoxCache!;
  if (!cache.has(key)) {
    const upper = motorSpeedBoxUpperUncached(device, positions, velocities);
    if (cache.size >= 8192) cache.delete(cache.keys().next().value!);
    cache.set(key, upper);
  }
  return cache.get(key)!;
};

const motorSpeedBoxUpperUncached = (device: MotorHost, positions: Interval[], velocities: Interval[]): number => {
  if (singleAxisMotor(device.motorType)) return velocities[0]!.maxAbs();
  const geometry = device.motorGeometry!;
  if (device.motorType === 7) {
    if (positions[1]!.lo === 0 && positions[1]!.hi === 0) {
      const beta = positions[2]!.add(geometry.beta).neg().mul(Math.PI / 180);
      const pitchVelocity = velocities[1]!.neg().mul(Math.PI / 180);
      const heightVelocity = geometry.base1 > 0 ? velocities[0]! : velocities[0]!.neg();
      return Math.max(
        ...geometry.points.map(([x, y]) =>
          pitchVelocity.mul(beta.trig().mul(x).add(beta.trig(true).mul(y))).sub(heightVelocity).maxAbs(),
        ),
      );
    }
    return multiPointMotorSpeedUpper(positions, velocities, geometry);
  }
  if (
    positions[1]!.lo === 0 &&
    positions[1]!.hi === 0 &&
    positions[2]!.lo === 0 &&
    positions[2]!.hi === 0 &&
    velocities[1]!.lo === 0 &&
    velocities[1]!.hi === 0 &&
    velocities[2]!.lo === 0 &&
    velocities[2]!.hi === 0
  ) {
    return velocities[0]!.maxAbs();
  }
  return xyMotorSpeedUpper(positions, velocities, geometry);
};

const phaseBoxes = (tracks: AxisTrack[], left: number, right: number): [Interval[], Interval[]] => {
  const positions: Interval[] = [];
  const velocities: Interval[] = [];
  for (const track of tracks) {
    const segment = track.segmentContaining((left + right) / 2);
    const samples = [segment.state(left), segment.state(right)];
    const positionValues = samples.map((value) => value[0]);
    if (segment.a) {
      const zero = segment.u0 - (segment.v0 / segment.a) * 1000;
      if (left < zero && zero < right) positionValues.push(segment.state(zero)[0]);
    }
    positions.push(I(Math.min(...positionValues), Math.max(...positionValues)));
    velocities.push(I(Math.min(...samples.map((value) => value[1])), Math.max(...samples.map((value) => value[1]))));
  }
  return [positions, velocities];
};

const boxPoseError = (device: MotorHost, positions: Interval[]): string | null => {
  if (singleAxisMotor(device.motorType)) return null;
  const geometry = device.motorGeometry!;
  const axes = device.motorType === 9 ? [1, 2] : [1];
  if (axes.some((axis) => positions[axis]!.lo <= -90 || positions[axis]!.hi >= 90)) return "准备或后续曲线倾角超出(-90,90)";
  const vertical =
    geometry.base1 > 0 ? positions[0]!.add(geometry.base1) : I(geometry.base2 + geometry.maxHeight).sub(positions[0]!);
  const heightTolerance = Math.max(
    1e-8,
    64 * ulp(Math.max(1, Math.abs(geometry.base1), Math.abs(geometry.base2 + geometry.maxHeight), positions[0]!.maxAbs())),
  );
  if (vertical.lo < -heightTolerance) return "准备或后续曲线的有效几何高度为负";
  return null;
};

const verifyMotorDevice = (
  device: MotorHost,
  entries: Record<number, MotorEntry>,
  plan: MotorPlan,
  trackOf: TrackFactory,
  checkDeadline: () => void,
): [boolean, string] => {
  const label = `模型${device.modelId}`;
  if (new Set(Object.keys(entries).map(Number)).size !== 3 || !entries[0] || !entries[1] || !entries[2]) {
    return [false, `${label}真实电机联合核对缺少虚轴计划`];
  }
  const tracks = [0, 1, 2].map((index) => {
    const sends: [number, EntryMove][] = entries[index]!.moves.map((move) => [move.send_u, move.move]);
    for (const [u, command] of device.tracks[index]!.sends) {
      if (u >= plan.u0 - 1e-9) sends.push([u, command]);
    }
    sends.sort((left, right) => left[0] - right[0]);
    return trackOf(device, index, device.current[index]!, sends);
  });
  const begin = Math.min(plan.clock_start_u, ...[0, 1, 2].flatMap((index) => entries[index]!.moves.map((move) => move.send_u)));
  const points = new Set<number>([begin]);
  for (const track of tracks) {
    for (const segment of track.segments) {
      for (const boundary of [segment.u0, segment.u1]) {
        if (Number.isFinite(boundary) && boundary > begin) points.add(boundary);
      }
    }
  }
  const ordered = [...points].sort((left, right) => left - right);
  const pending: [number, number, number][] =
    ordered.length > 1
      ? ordered.slice(0, -1).map((left, index) => [left, ordered[index + 1]!, 0])
      : [[begin, begin, 0]];
  const tolerance = Math.max(1e-8, device.motorLimit * 1e-9);
  while (pending.length > 0) {
    checkDeadline();
    const [left, right, depth] = pending.pop()!;
    const [positions, velocities] = phaseBoxes(tracks, left, right);
    const error = boxPoseError(device, positions);
    if (error) return [false, `${label}${error}`];
    const directionValid = directionBoxValid(device, positions);
    let upper = Number.POSITIVE_INFINITY;
    if (directionValid) {
      try {
        upper = motorSpeedBoxUpper(device, positions, velocities);
      } catch {
        upper = Number.POSITIVE_INFINITY;
      }
    }
    if (Number.isFinite(upper) && upper <= device.motorLimit + tolerance) continue;
    const middle = (left + right) / 2;
    for (const stamp of [left, middle, right]) {
      checkDeadline();
      const states = tracks.map((track) => track.state(stamp));
      const position = states.map((state) => state[0]);
      const velocity = states.map((state) => state[1]);
      if (!directionBoxValid(device, position.map((value) => I(value)))) {
        return [false, `${label}实际运动在${stamp.toFixed(6)}ms没有有效几何边距`];
      }
      let speed: number;
      try {
        speed = motorStateSpeed(device, position, velocity);
      } catch (error) {
        return [false, `${label}实际运动几何正解失败，${error instanceof Error ? error.message : String(error)}`];
      }
      if (!Number.isFinite(speed) || speed > device.motorLimit + tolerance) {
        if (Number.isFinite(speed) && stamp <= plan.u0 + 1e-8) {
          plan.motorTimeHintScale = Math.max(1.2, speed / device.motorLimit);
        }
        return [false, `${label}实际电机速度${speed.toFixed(6)}超过上限${device.motorLimit.toFixed(6)}`];
      }
    }
    if (depth >= 24 || middle === left || middle === right) return [false, `${label}运动区间无法可靠包围在真实电机速度上限内`];
    pending.push([left, middle, depth + 1], [middle, right, depth + 1]);
  }
  return [true, ""];
};

export const verifyMotorPlan = (
  plan: MotorPlan,
  trackOf: TrackFactory,
  checkDeadline: () => void,
): [boolean, string] => {
  const grouped = new Map<MotorHost, Record<number, MotorEntry>>();
  const keyParts: unknown[] = [];
  for (const [device, entry] of plan.entries) {
    if (device.motorType === null || device.motorType === undefined) continue;
    const entries = grouped.get(device) ?? {};
    entries[entry.index] = entry;
    grouped.set(device, entries);
    keyParts.push([
      device.modelId,
      entry.index,
      device.tracks[entry.index]!.serial,
      entry.moves.map((move) => [move.send_u, move.move.pos, move.move.vel, move.move.accVel, move.move.decVel]),
    ]);
  }
  const key = keyOf([
    plan.u0,
    plan.clock_start_u,
    plan.entries.map(([device]) => [device.modelId, device.positionPeriodH]),
    keyParts,
  ]);
  if (plan.motorVerificationCertificate && plan.motorVerificationCertificate[0] === key) {
    return plan.motorVerificationCertificate[1];
  }
  let result: [boolean, string] = [true, ""];
  const owner = plan.entries[0]![0];
  if (!owner.motorMotionCertificates) {
    owner.motorMotionCertificates = new Map();
    owner.motorSharedBoxCache = new Map();
  }
  const shared = owner.motorMotionCertificates;
  for (const [device, entries] of grouped) {
    checkDeadline();
    device.motorBoxCache = owner.motorSharedBoxCache;
    if (device.motorReferenceSignature === undefined) {
      device.motorReferenceSignature = keyOf(
        device.tracks.map((track) => track.sends.map(([u, command]) => [u, command.pos, command.vel, command.accVel, command.decVel])),
      );
    }
    const motionKey = keyOf([
      device.motorType,
      device.motorLimit,
      device.positionPeriodH,
      device.motorGeometrySignature ?? null,
      device.current,
      plan.u0,
      plan.clock_start_u,
      device.motorReferenceSignature,
      [0, 1, 2].map((index) =>
        entries[index]!.moves.map((move) => [move.send_u, move.move.pos, move.move.vel, move.move.accVel, move.move.decVel]),
      ),
    ]);
    if (shared.has(motionKey)) continue;
    result = verifyMotorDevice(device, entries, plan, trackOf, checkDeadline);
    if (!result[0]) break;
    if (shared.size >= 4096) shared.delete(shared.keys().next().value!);
    shared.set(motionKey, true);
  }
  plan.motorVerificationCertificate = [key, result];
  return result;
};

/**
 * 强制准备的实轴速度上界，对应 python/强制就近算法/就近接入计算.py
 * 的 _prepare_motor_speed_bound 与方向域检查。几何区间与非强制核对共用。
 */
export type ForcedPrepareMotorInput = {
  /** 几何类型：1 单点/多级升降，4 无极旋转，8 普通多点，9 XY 多点 */
  kind: 1 | 4 | 8 | 9;
  motorNum: number;
  modelId: number;
  geometry: MotorGeometry | null;
  current: readonly number[];
  target: readonly number[];
  velocity: readonly number[];
  acceleration: readonly number[];
  deceleration: readonly number[];
  totalTime: number;
};

const copySign = (magnitude: number, signSource: number): number =>
  signSource < 0 || Object.is(signSource, -0) ? -Math.abs(magnitude) : Math.abs(magnitude);

const radialDistance = (geometry: MotorGeometry, beta: number): number => {
  const sine = Math.sin(beta);
  const cosine = Math.cos(beta);
  let minimum = Number.POSITIVE_INFINITY;
  for (const edge of geometry.edges) {
    const dx = (edge.dx.lo + edge.dx.hi) / 2;
    const dy = (edge.dy.lo + edge.dy.hi) / 2;
    const denominator = sine * dy - cosine * dx;
    if (Math.abs(denominator) <= 1e-12) continue;
    const radius = (edge.x * dy - edge.y * dx) / denominator;
    const fraction = (edge.x * cosine - edge.y * sine) / denominator;
    if (radius > 0 && -1e-12 <= fraction && fraction <= 1 + 1e-12) minimum = Math.min(minimum, radius);
  }
  if (!Number.isFinite(minimum)) throw new Error("当前倾斜方向无法求得有效凸包边距，请检查吊点与原点");
  return minimum;
};

const ordinaryForwardPosition = (
  height: number,
  argXDeg: number,
  argYDeg: number,
  geometry: MotorGeometry,
): number[] => {
  const beta = -((argYDeg + geometry.beta) * Math.PI) / 180;
  const angle = -(argXDeg * Math.PI) / 180;
  const cb = Math.cos(beta);
  const sb = Math.sin(beta);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const vertical = geometry.base1 > 0 ? height + geometry.base1 : geometry.base2 + geometry.maxHeight - height;
  let offset = 0;
  if (angle !== 0) {
    const radius = radialDistance(geometry, beta);
    const power = Math.min(100, 1.73 + (0.52 * vertical) / radius);
    offset = copySign(Math.min(radius, radius * (Math.abs(angle) / 1.5707963) ** power), angle);
  }
  return geometry.points.map(([x, y]) => {
    const x1 = cb * x - sb * y;
    const y1 = sb * x + cb * y;
    const rx = cb * x1 + sb * ca * y1 - x + sb * offset;
    const ry = -sb * x1 + cb * ca * y1 - y + cb * offset;
    const rz = sa * y1 - vertical;
    const length = Math.sqrt(rx * rx + ry * ry + rz * rz);
    return geometry.base1 > 0 ? length - geometry.base1 : geometry.base2 + geometry.maxHeight - length;
  });
};

/** _xy_point_motion 在零速度下的第一组绳长，只用于端点正解是否有限 */
const xyRopeLengths = (pose: readonly number[], geometry: MotorGeometry): number[] => {
  if (geometry.beta !== 0) throw new Error("XY多点摆betainit必须为0");
  const height = pose[0]!;
  const angleX = pose[1]!;
  const angleY = pose[2]!;
  if (Math.abs(angleX) >= 90 || Math.abs(angleY) >= 90) throw new Error("XY多点摆X/Y角须在(-90,90)内");
  const radians = Math.PI / 180;
  const pitch = -angleX * radians;
  const roll = -angleY * radians;
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const tilt = Math.acos(Math.max(-1, Math.min(1, cp * cr)));
  const vertical = geometry.base1 > 0 ? height + geometry.base1 : geometry.base2 + geometry.maxHeight - height;
  let offsetX = 0;
  let offsetY = 0;
  if (tilt > 1e-8 && geometry.edges.length > 0) {
    let beta = Math.acos(Math.max(-1, Math.min(1, sp / Math.sin(tilt))));
    if (-sr * cp < 0) beta = -beta;
    const dx = Math.sin(beta);
    const dy = Math.cos(beta);
    const [radius] = xyRadiusCandidates(dx, dy, 0, geometry)[0]!;
    const power = Math.min(100, 1.73 + 0.52 * (vertical / radius));
    const ratio = tilt / 1.5707963;
    const weight = ratio ** power;
    const offset = weight >= 1 ? radius : radius * weight;
    offsetX = dx * offset;
    offsetY = dy * offset;
  }
  return geometry.points.map(([x, y, z]) => {
    const y1 = cp * y - sp * z;
    const z1 = sp * y + cp * z;
    const relative = [cr * x + sr * z1 - x + offsetX, y1 - y + offsetY, -sr * x + cr * z1 - z - vertical];
    const length = Math.sqrt(pythonSum(relative.map((value) => value * value)));
    return geometry.base1 > 0 ? length - geometry.base1 : geometry.base2 + geometry.maxHeight - length;
  });
};

const prepareMotorPositions = (pose: readonly number[], geometry: MotorGeometry, xy: boolean): number[] =>
  xy ? xyRopeLengths(pose, geometry) : ordinaryForwardPosition(pose[0]!, pose[1]!, pose[2]!, geometry);

const prepareAxisPosition = (
  start: number,
  finish: number,
  velocity: number,
  acceleration: number,
  deceleration: number,
  timeS: number,
): number => {
  const distance = Math.abs(finish - start);
  if (distance === 0) return start;
  const accelerateS = velocity / acceleration;
  const decelerateS = velocity / deceleration;
  const cruiseS = Math.max(0, distance / velocity - (accelerateS + decelerateS) / 2);
  const totalS = accelerateS + cruiseS + decelerateS;
  const clamped = Math.min(totalS, Math.max(0, timeS));
  const travelled =
    clamped < accelerateS
      ? (acceleration * clamped * clamped) / 2
      : clamped < accelerateS + cruiseS
        ? velocity * (clamped - accelerateS / 2)
        : distance - (deceleration * (totalS - clamped) ** 2) / 2;
  return start + copySign(Math.min(distance, Math.max(0, travelled)), finish - start);
};

const prepareMotorSpeedBound = (
  current: readonly number[],
  target: readonly number[],
  velocity: readonly number[],
  acceleration: readonly number[],
  deceleration: readonly number[],
  totalTime: number,
  geometry: MotorGeometry,
  xy: boolean,
): number => {
  const speed = [0, 1, 2].map((axis) => {
    const peak = velocity[axis]!;
    return target[axis]! > current[axis]! ? I(0, peak) : I(-peak, 0);
  });
  const upperOf = xy ? xyMotorSpeedUpper : multiPointMotorSpeedUpper;
  const instantaneousOf = xy ? xyInstantaneousSpeed : multiPointInstantaneousSpeed;
  const signed = [0, 1, 2].map((axis) =>
    target[axis] === current[axis] ? 0 : copySign(velocity[axis]!, target[axis]! - current[axis]!),
  );
  const pending: Array<[number, number, number]> = [[0, totalTime, 0]];
  let maximum = 0;
  while (pending.length > 0) {
    const [left, right, depth] = pending.pop()!;
    const box = [0, 1, 2].map((axis) => {
      const values = [left, right].map((timeS) =>
        prepareAxisPosition(current[axis]!, target[axis]!, velocity[axis]!, acceleration[axis]!, deceleration[axis]!, timeS),
      );
      return I(Math.min(...values), Math.max(...values));
    });
    const bound = upperOf(box, speed, geometry);
    if (Number.isFinite(bound) && depth < 4) {
      const middlePosition = [0, 1, 2].map((axis) =>
        prepareAxisPosition(
          current[axis]!,
          target[axis]!,
          velocity[axis]!,
          acceleration[axis]!,
          deceleration[axis]!,
          (left + right) / 2,
        ),
      );
      const estimate = instantaneousOf(middlePosition, signed, geometry);
      if (bound > 4 * Math.max(estimate, 1e-6)) {
        const middle = (left + right) / 2;
        pending.push([left, middle, depth + 1], [middle, right, depth + 1]);
        continue;
      }
    }
    if (Number.isFinite(bound)) maximum = Math.max(maximum, bound);
    else if (depth < 16) {
      const middle = (left + right) / 2;
      pending.push([left, middle, depth + 1], [middle, right, depth + 1]);
    } else {
      throw new Error("准备路径无法得到有限的实轴速度上界，请检查几何与姿态");
    }
  }
  return maximum;
};

type DirectionProfile = {
  start: number;
  finish: number;
  sign: number;
  peak: number;
  acceleration: number;
  deceleration: number;
  accelerateS: number;
  decelerateAt: number;
  end: number;
};

const prepareDirectionProfile = (
  start: number,
  finish: number,
  velocity: number,
  acceleration: number,
  deceleration: number,
): DirectionProfile => {
  const distance = Math.abs(finish - start);
  if (distance === 0) {
    return { start, finish, sign: 0, peak: 0, acceleration: 0, deceleration: 0, accelerateS: 0, decelerateAt: 0, end: 0 };
  }
  if (Math.min(velocity, acceleration, deceleration) <= 0) {
    throw new Error("有位移的准备轴须使用正速度与正加减速度");
  }
  const peak = Math.min(
    velocity,
    Math.sqrt((2 * acceleration * deceleration * distance) / (acceleration + deceleration)),
  );
  const accelerateS = peak / acceleration;
  const decelerateS = peak / deceleration;
  const cruiseS = Math.max(0, distance / peak - (accelerateS + decelerateS) / 2);
  return {
    start,
    finish,
    sign: copySign(1, finish - start),
    peak,
    acceleration,
    deceleration,
    accelerateS,
    decelerateAt: accelerateS + cruiseS,
    end: accelerateS + cruiseS + decelerateS,
  };
};

const prepareDirectionPosition = (profile: DirectionProfile, timeS: number): number => {
  if (timeS >= profile.end) return profile.finish;
  const clamped = Math.max(0, timeS);
  const travelled =
    clamped < profile.accelerateS
      ? (profile.acceleration * clamped * clamped) / 2
      : clamped < profile.decelerateAt
        ? profile.peak * (clamped - profile.accelerateS / 2)
        : Math.abs(profile.finish - profile.start) - (profile.deceleration * (profile.end - clamped) ** 2) / 2;
  return profile.start + profile.sign * Math.min(Math.abs(profile.finish - profile.start), Math.max(0, travelled));
};

const checkPrepareDirectionDomain = (
  current: readonly number[],
  target: readonly number[],
  velocity: readonly number[],
  acceleration: readonly number[],
  deceleration: readonly number[],
  totalTime: number,
  geometry: MotorGeometry,
  xy: boolean,
): void => {
  if (xy && [current, target].some((position) => Math.abs(position[1]!) >= 90 || Math.abs(position[2]!) >= 90)) {
    throw new Error("XY多点摆X/Y角须在(-90,90)内");
  }
  if ((xy && geometry.points.length === 2) || (!xy && current[1] === 0 && target[1] === 0)) return;
  const domain = prepareDirectionDomain(geometry);
  if (domain === null) return;
  const [left, right] = domain;
  if (!xy) {
    const values = [current, target].map((position) => -((position[2]! + geometry.beta) * Math.PI) / 180);
    const start = Math.min(...values);
    const finish = Math.max(...values);
    const shift = Math.floor((start - left) / TAU);
    const inside = [shift - 1, shift, shift + 1].some(
      (turn) => start >= left + turn * TAU - 1e-12 && finish <= right + turn * TAU + 1e-12,
    );
    if (!inside) throw new Error("普通多点摆准备路径中存在无法求得凸包边距的倾斜方向");
    return;
  }
  const sineLeft = I(left).trig();
  const cosineLeft = I(left).trig(true);
  const sineRight = I(right).trig();
  const cosineRight = I(right).trig(true);
  const profiles = [1, 2].map((axis) =>
    prepareDirectionProfile(current[axis]!, target[axis]!, velocity[axis]!, acceleration[axis]!, deceleration[axis]!),
  );
  const end = Math.max(totalTime, ...profiles.map((profile) => profile.end));
  const marks = new Set<number>([0, end]);
  for (const profile of profiles) {
    for (const timeS of [profile.accelerateS, profile.decelerateAt, profile.end]) {
      if (timeS > 0 && timeS < end) marks.add(timeS);
    }
  }
  const times = [...marks].sort((leftTime, rightTime) => leftTime - rightTime);
  const pending: Array<[number, number, number]> =
    end > 0 ? times.slice(0, -1).map((start, index) => [start, times[index + 1]!, 0]) : [[0, 0, 0]];
  while (pending.length > 0) {
    const [start, finish, depth] = pending.pop()!;
    const samples = profiles.map((profile) => [start, finish].map((timeS) => prepareDirectionPosition(profile, timeS)));
    const maxAngles = samples.map((row) => (Math.max(...row.map((value) => Math.abs(value))) * Math.PI) / 180);
    if (Math.acos(Math.min(1, Math.cos(maxAngles[0]!) * Math.cos(maxAngles[1]!))) <= 1e-8) continue;
    const pitch = I(Math.min(...samples[0]!), Math.max(...samples[0]!))
      .neg()
      .mul(Math.PI / 180);
    const roll = I(Math.min(...samples[1]!), Math.max(...samples[1]!))
      .neg()
      .mul(Math.PI / 180);
    const nx = roll.neg().trig().mul(pitch.trig(true));
    const ny = pitch.trig();
    const tolerance = 1e-12 * Math.hypot(nx.maxAbs(), ny.maxAbs());
    const crossLeft = sineLeft.mul(ny).sub(cosineLeft.mul(nx));
    const crossRight = nx.mul(cosineRight).sub(ny.mul(sineRight));
    if (crossLeft.hi <= tolerance && crossRight.hi <= tolerance) continue;
    const middle = (start + finish) / 2;
    for (const timeS of [start, middle, finish]) {
      const samplePitch = -(prepareDirectionPosition(profiles[0]!, timeS) * Math.PI) / 180;
      const sampleRoll = -(prepareDirectionPosition(profiles[1]!, timeS) * Math.PI) / 180;
      if (Math.acos(Math.max(-1, Math.min(1, Math.cos(samplePitch) * Math.cos(sampleRoll)))) <= 1e-8) continue;
      const sampleNx = -Math.sin(sampleRoll) * Math.cos(samplePitch);
      const sampleNy = Math.sin(samplePitch);
      const sampleTolerance = 1e-12 * Math.hypot(sampleNx, sampleNy);
      if (
        Math.sin(left) * sampleNy - Math.cos(left) * sampleNx > sampleTolerance ||
        sampleNx * Math.cos(right) - sampleNy * Math.sin(right) > sampleTolerance
      ) {
        throw new Error("XY多点摆准备路径中存在无法求得凸包边距的倾斜方向");
      }
    }
    if (depth >= 32 || middle === start || middle === finish) {
      throw new Error("XY多点摆准备方向接近凸包边界，无法可靠包围整段运动");
    }
    pending.push([start, middle, depth + 1], [middle, finish, depth + 1]);
  }
};

export const forcedPrepareMotorBound = (input: ForcedPrepareMotorInput): number => {
  const { kind, motorNum, modelId, current, target } = input;
  // 无极旋转的实轴直接跟随 H（与单点相同），目标已按周期规范
  if (kind === 1 || kind === 4) {
    const endpoints = [current, target].map((pose) => Array.from({ length: motorNum }, () => pose[0]!));
    if (endpoints.some((values) => values.length !== motorNum || values.some((value) => !Number.isFinite(value)))) {
      throw new Error(`模型${modelId}端点正解未返回有效电机位置`);
    }
    const bound = input.velocity[0]!;
    if (!Number.isFinite(bound) || bound < 0) throw new Error(`模型${modelId}的电机速度上界无效`);
    return bound;
  }
  const geometry = input.geometry;
  if (!geometry) throw new Error(`模型${modelId}的几何参数缺失或非有限`);
  const xy = kind === 9;
  const effective = [current, target].map((pose) =>
    geometry.base1 > 0 ? pose[0]! + geometry.base1 : geometry.base2 + geometry.maxHeight - pose[0]!,
  );
  if (Math.min(...effective) < 0) throw new Error(`模型${modelId}准备路径的有效高度不能为负`);
  const tiltAxes = xy ? [1, 2] : [1];
  if (tiltAxes.some((axis) => [current, target].some((pose) => Math.abs(pose[axis]!) >= 90))) {
    throw new Error(`模型${modelId}准备倾角须在(-90,90)内`);
  }
  const endpoints = [current, target].map((pose) => prepareMotorPositions(pose, geometry, xy));
  if (endpoints.some((values) => values.length !== motorNum || values.some((value) => !Number.isFinite(value)))) {
    throw new Error(`模型${modelId}端点正解未返回有效电机位置`);
  }
  checkPrepareDirectionDomain(
    current,
    target,
    input.velocity,
    input.acceleration,
    input.deceleration,
    input.totalTime,
    geometry,
    xy,
  );
  const bound = tiltAxes.every((axis) => current[axis] === 0 && target[axis] === 0)
    ? input.velocity[0]!
    : prepareMotorSpeedBound(
        current,
        target,
        input.velocity,
        input.acceleration,
        input.deceleration,
        input.totalTime,
        geometry,
        xy,
      );
  if (!Number.isFinite(bound) || bound < 0) throw new Error(`模型${modelId}的电机速度上界无效`);
  return bound;
};

/** 归一化时建立 7/9 几何；modelType 为业务编号，XY 必须 betainit 为 0 */
export const prepareEntryGeometry = (model: Record<string, unknown>): MotorGeometry => prepareMultiPointGeometry(model);

type Bounds = { readonly lo: number; readonly hi: number };

/**
 * 调速范围（python/调速范围计算）与非强制共用同一套多点/XY 正解速度：
 * 一个 H/P/Y 位置、速度区间盒内实轴速度的上界。7 普通多点摆，9 XY多点摆。
 */
export const motorSpeedUpperOf = (
  positions: readonly Bounds[],
  velocities: readonly Bounds[],
  geometry: MotorGeometry,
  xy: boolean,
): number => {
  const q = positions.map((value) => I(value.lo, value.hi));
  const v = velocities.map((value) => I(value.lo, value.hi));
  return xy ? xyMotorSpeedUpper(q, v, geometry) : multiPointMotorSpeedUpper(q, v, geometry);
};

/** 某一时刻实轴的解析瞬时峰速（区间搜索的候选值，不是上界） */
export const motorInstantaneousSpeedOf = (
  position: readonly number[],
  velocity: readonly number[],
  geometry: MotorGeometry,
  xy: boolean,
): number =>
  xy
    ? xyInstantaneousSpeed([...position], [...velocity], geometry)
    : multiPointInstantaneousSpeed([...position], [...velocity], geometry);
